import { parseCertificate } from "zklean";
import { MEDIA_TYPE, encodeDiscovery, methodName } from "./protocol.ts";
import type { Certificate, Handler, ServeOptions, Source } from "./types.ts";

/** The HTTPV media type is listed by name, not by a wildcard, with no
 * parameter but an optional weight above zero (RFC 9110, Section 12.4.2). */
function acceptsDiscovery(accept: string | null): boolean {
  return (accept ?? "").split(",").some((range) => {
    const [type, ...parameters] = range
      .split(";")
      .map((part) => part.trim().toLowerCase());
    if (type !== MEDIA_TYPE || parameters.length > 1) return false;
    const weight = parameters[0]?.match(/^q=(0(\.\d{0,3})?|1(\.0{0,3})?)$/);
    return parameters.length === 0 || (!!weight && Number(weight[1]) > 0);
  });
}

/** Answer HTTPV discovery and pass every other request to `fetch`, including
 * OPTIONS for a resource without certificates. Paths match the URL parser's
 * normalized path exactly, and the query is ignored. Static certificates are validated at startup; providers
 * run on every discovery request. */
export function serve({ routes, fetch }: ServeOptions): { fetch: Handler } {
  const paths = new Map<string, Map<string, Source>>();
  for (const [route, source] of Object.entries(routes)) {
    const [method, path, extra] = route.split(" ");
    if (
      !method ||
      !path?.startsWith("/") ||
      extra !== undefined ||
      /[?#*]/.test(path)
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
      if (!methods) return fetch(request);
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
        return Response.json(encodeDiscovery(certificates), {
          headers: { "Content-Type": MEDIA_TYPE, "Cache-Control": "no-store" },
        });
      } catch {
        return new Response(null, {
          status: 503,
          headers: { "Cache-Control": "no-store" },
        });
      }
    },
  };
}
