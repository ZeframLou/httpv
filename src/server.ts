import { parseCertificate } from "zklean";
import { MEDIA_TYPE, encodeDiscovery, methodName } from "./protocol.ts";
import type { Certificate, Handler, ServeOptions, Source } from "./types.ts";

/** The HTTPV media type is listed without `q=0`, which means "not acceptable". */
function acceptsDiscovery(accept: string | null): boolean {
  return (accept ?? "").split(",").some((range) => {
    const [type, ...parameters] = range
      .toLowerCase()
      .split(";")
      .map((part) => part.replace(/\s/g, ""));
    return (
      type === MEDIA_TYPE &&
      !parameters.some((parameter) => /^q=0(\.0*)?$/.test(parameter))
    );
  });
}

/** Answer HTTPV discovery and pass every other request to `fetch`.
 * Paths match exactly. Static certificates are validated at startup;
 * providers run on every discovery request. */
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
      typeof source === "function" ? source : parseCertificate(source),
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
      // A CORS preflight is the browser asking about a later request, never
      // discovery, so the application answers it.
      if (
        request.method !== "OPTIONS" ||
        request.headers.has("access-control-request-method") ||
        !acceptsDiscovery(request.headers.get("accept"))
      )
        return fetch(request);
      const methods = paths.get(new URL(request.url).pathname);
      if (!methods)
        return Response.json(
          { error: "no certificate" },
          { status: 404, headers },
        );
      try {
        // fromEntries defines own properties, so a method named __proto__ works.
        const certificates: Record<string, Certificate> = Object.fromEntries(
          await Promise.all(
            [...methods].map(async ([method, source]) => [
              method,
              typeof source === "function"
                ? parseCertificate(await source())
                : source,
            ]),
          ),
        );
        return Response.json(encodeDiscovery(certificates), { headers });
      } catch {
        return Response.json(
          { error: "certificate unavailable" },
          { status: 503, headers },
        );
      }
    },
  };
}
