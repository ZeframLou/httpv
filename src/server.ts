import {
  MEDIA_TYPE,
  encodeDiscovery,
  methodName,
  parseAdvertisement,
} from "./protocol.ts";
import type { Advertisement, Handler, ServeOptions, Source } from "./types.ts";

function acceptsDiscovery(accept: string | null): boolean {
  return (accept ?? "")
    .split(",")
    .some((part) => part.split(";")[0]!.trim().toLowerCase() === MEDIA_TYPE);
}

/** Answer HTTPV discovery and pass every other request to `fetch`.
 * Paths match exactly. Static advertisements are validated at startup;
 * providers run on every discovery request, so they can change both fields together. */
export function serve({ routes, fetch }: ServeOptions): { fetch: Handler } {
  const paths = new Map<string, Map<string, Source>>();
  for (const [route, source] of Object.entries(routes)) {
    const [method, path, extra] = route.split(" ");
    if (
      !method ||
      !path?.startsWith("/") ||
      extra !== undefined ||
      /[?#]/.test(path)
    )
      throw new Error(`invalid route: ${route}`);
    const methods = paths.get(path) ?? new Map<string, Source>();
    const name = methodName(method);
    if (methods.has(name)) throw new Error(`duplicate route: ${route}`);
    methods.set(
      name,
      typeof source === "function" ? source : parseAdvertisement(source),
    );
    paths.set(path, methods);
  }
  const headers = {
    "Content-Type": MEDIA_TYPE,
    "Cache-Control": "no-store",
    Vary: "Accept",
  };
  return {
    async fetch(request) {
      if (
        request.method !== "OPTIONS" ||
        !acceptsDiscovery(request.headers.get("accept"))
      )
        return fetch(request);
      const methods = paths.get(new URL(request.url).pathname);
      if (!methods)
        return Response.json(
          { error: "no contract" },
          { status: 404, headers },
        );
      try {
        const contracts: Record<string, Advertisement> = {};
        for (const [method, source] of methods)
          contracts[method] =
            typeof source === "function"
              ? parseAdvertisement(await source())
              : source;
        return Response.json(encodeDiscovery(contracts), { headers });
      } catch {
        return Response.json(
          { error: "contract unavailable" },
          { status: 503, headers },
        );
      }
    },
  };
}
