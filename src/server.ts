import { DISCOVERY_FORMAT, parseAdvertisement } from "./advertisement.ts";
import type { Advertisement, Handler, ServeOptions } from "./types.ts";

export const MEDIA_TYPE = "application/httpv+json";
export function methodName(method: string): string {
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(method))
    throw new Error("invalid HTTP method");
  const upper = method.toUpperCase();
  // Fetch normalizes standard methods. Extension methods remain case-sensitive.
  return ["DELETE", "GET", "HEAD", "OPTIONS", "POST", "PUT"].includes(upper)
    ? upper
    : method;
}

function accepts(value: string | null): boolean {
  return (value ?? "").split(",").some((part) => {
    const [type, ...parameters] = part.trim().toLowerCase().split(";");
    return (
      type === MEDIA_TYPE &&
      !parameters.some((p) => /^\s*q\s*=\s*0(?:\.0*)?\s*$/.test(p))
    );
  });
}

/** Return a Fetch handler usable directly with Bun.serve or any Fetch adapter.
 * Paths match exactly; parameterized routes should use a provider function in
 * an application's router, where parameter scope can be explicitly enforced. */
export function discoveryHandler(options: ServeOptions): Handler {
  const paths = new Map<string, Map<string, ServeOptions["routes"][string]>>();
  for (const [route, source] of Object.entries(options.routes)) {
    const split = route.indexOf(" ");
    if (split < 1) throw new Error(`invalid route: ${route}`);
    const method = methodName(route.slice(0, split));
    const path = route.slice(split + 1);
    if (!path.startsWith("/") || path.includes("#") || path.includes("?"))
      throw new Error(`invalid resource path: ${path}`);
    const methods = paths.get(path) ?? new Map();
    if (methods.has(method)) throw new Error(`duplicate route: ${route}`);
    // Static declarations are snapshots. Providers return a complete pair when
    // deployments need to change the certificate and entrypoint together.
    const pinned =
      typeof source === "function"
        ? source
        : typeof source.certificate === "string"
          ? { operation: source.operation, certificate: source.certificate }
          : parseAdvertisement(source);
    methods.set(method, pinned);
    paths.set(path, methods);
  }
  return async (request) => {
    if (request.method !== "OPTIONS" || !accepts(request.headers.get("accept")))
      return options.fetch(request);
    const methods = paths.get(new URL(request.url).pathname);
    const headers = {
      "Content-Type": MEDIA_TYPE,
      "Cache-Control": "no-store",
      Vary: "Accept",
    };
    if (!methods)
      return Response.json(
        { error: "No advertised contract for this resource" },
        { status: 404, headers },
      );
    try {
      const entries = await Promise.all(
        [...methods].map(async ([method, source]) => {
          // Files and providers are reloaded for each advertisement, including upgrades.
          const value =
            typeof source === "function"
              ? await source()
              : {
                  operation: source.operation,
                  certificate:
                    typeof source.certificate === "string"
                      ? await Bun.file(source.certificate).json()
                      : source.certificate,
                };
          return [method, parseAdvertisement(value)] as const;
        }),
      );
      const contracts: Record<string, Advertisement> =
        Object.fromEntries(entries);
      return Response.json(
        { format: DISCOVERY_FORMAT, contracts },
        { headers },
      );
    } catch {
      return Response.json(
        { error: "Advertised contract unavailable" },
        { status: 503, headers },
      );
    }
  };
}
