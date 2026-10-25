import { parseCertificate } from "zklean/encoding";
import { FORMAT, MEDIA_TYPE, methodName } from "./protocol.ts";
import type { Certificate, Handler, ServeOptions, Source } from "./types.ts";

/** Whether `Accept` lists the HTTPV media type, other than with weight 0.
 * Quoted strings are blanked first, since they may contain commas. */
function acceptsDiscovery(accept: string | null): boolean {
  return (accept ?? "")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .toLowerCase()
    .split(",")
    .some((range) => {
      const [type, ...parameters] = range.split(";").map((part) => part.trim());
      return (
        type === MEDIA_TYPE && !parameters.some((p) => /^q=0(\.0*)?$/.test(p))
      );
    });
}

/** Answer HTTPV discovery and pass every other request to `fetch`, including
 * OPTIONS for a path without certificates. Each method maps to its own
 * certificate, so changing one endpoint's claims leaves its siblings' clients
 * undisturbed; a failing provider makes discovery fail for the whole path.
 * Paths are compared as the URL parser normalizes them, without
 * the query. Static certificates are checked at startup, providers on every
 * discovery request; ZKLean rejects a source that is not https. */
export function serve({ routes, fetch }: ServeOptions): { fetch: Handler } {
  const paths = new Map<string, Map<string, Source>>();
  for (const [route, source] of Object.entries(routes)) {
    const [method = "", path = "", extra] = route.split(" ");
    // A path the URL parser would rewrite could never match a request.
    if (
      extra !== undefined ||
      // A runtime may present `OPTIONS *` as the path `/*` (SPEC 3.1).
      path === "/*" ||
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
        return new Response(null, { status: 503 });
      }
    },
  };
}
