import { parseCertificate } from "zklean";
import { FORMAT, MEDIA_TYPE, methodName } from "./protocol.ts";
import type { Certificate, Handler, ServeOptions, Source } from "./types.ts";

/** Whether `Accept` lists the HTTPV media type by name, not by a wildcard,
 * with no parameter but an optional weight above zero (RFC 9110, Section
 * 12.4.2). Quoted strings are blanked first: they only occur in parameters,
 * which disqualify a range anyway, and may contain commas. */
function acceptsDiscovery(accept: string | null): boolean {
  const unquoted = (accept ?? "").replace(/"(?:\\.|[^"\\])*"/g, '""');
  return unquoted.split(",").some((range) => {
    const [type, weight, extra] = range
      .split(";")
      .map((part) => part.trim().toLowerCase())
      .filter((part, index) => index === 0 || part);
    if (type !== MEDIA_TYPE || extra !== undefined) return false;
    const q = weight && /^q=(0(\.\d{0,3})?|1(\.0{0,3})?)$/.exec(weight);
    return weight === undefined || (!!q && Number(q[1]) > 0);
  });
}

/** Answer HTTPV discovery and pass every other request to `fetch`, including
 * OPTIONS for a path without certificates. Each method maps to its own
 * certificate, so a change to one endpoint leaves its siblings' clients
 * undisturbed. Paths are compared as the URL parser normalizes them, without
 * the query. Static certificates are checked at startup, providers on every
 * discovery request; ZKLean rejects a source that is not https. */
export function serve({ routes, fetch }: ServeOptions): { fetch: Handler } {
  const paths = new Map<string, Map<string, Source>>();
  for (const [route, source] of Object.entries(routes)) {
    const [method = "", path = "", extra] = route.split(" ");
    // A path the URL parser would rewrite could never match a request.
    if (
      extra !== undefined ||
      path.includes("*") ||
      new URL(path, "http://host").pathname !== path
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
        return Response.json(
          { format: FORMAT, certificates },
          {
            headers: {
              "Content-Type": MEDIA_TYPE,
              "Cache-Control": "no-store",
            },
          },
        );
      } catch {
        return new Response(null, {
          status: 503,
          headers: { "Cache-Control": "no-store" },
        });
      }
    },
  };
}
