import { expect, test } from "bun:test";
import { createHTTPV, MEDIA_TYPE, serve } from "../src/index.ts";
import { inventory, listen } from "./helpers.ts";

const { v1, v3 } = inventory();
const malformed = { ...v1, extra: 1 };
const local = { method: "POST", allowInsecureHttp: true };
const ask = (url: string, accept: string, extra: HeadersInit = {}) =>
  fetch(url, { method: "OPTIONS", headers: { Accept: accept, ...extra } });

/** A client whose transport returns one canned response. */
function respond(body: unknown, init: ResponseInit = {}) {
  return createHTTPV({
    fetch: async () =>
      Response.json(body, { headers: { "content-type": MEDIA_TYPE }, ...init }),
  });
}

test("discovery returns the certificate; every other request reaches the application", async () => {
  using app = listen(v1);
  const httpv = createHTTPV();
  expect(await httpv.query(app.url, local)).toEqual(v1);
  expect((await ask(app.url, MEDIA_TYPE)).headers.get("cache-control")).toBe(
    "no-store",
  );
  // Only OPTIONS is discovery, whatever the request accepts.
  for (const method of ["POST", "OPTIONS"])
    expect(
      await fetch(app.url, {
        method,
        headers: method === "POST" ? { Accept: MEDIA_TYPE } : {},
      }).then((r) => r.json()),
    ).toEqual({ method });
  // A path without certificates gets the application's own OPTIONS response.
  const other = app.url.replace("reservations", "other");
  expect(await ask(other, MEDIA_TYPE).then((r) => r.json())).toEqual({
    method: "OPTIONS",
  });
  for (const url of [other, app.url])
    await expect(
      httpv.query(url, { ...local, method: url === other ? "POST" : "GET" }),
    ).rejects.toMatchObject({ reason: "missing-certificate" });
});

test("discovery needs HTTPS, except to loopback, and a well-formed request", async () => {
  const sent: URL[] = [];
  const httpv = createHTTPV({
    fetch: async (url) => {
      sent.push(url);
      return new Response();
    },
  });
  for (const [url, method] of [
    ["https://inventory.example/reservations", "BAD()"],
    ["http://inventory.example/reservations", "POST"],
    ["https://user@inventory.example/reservations", "POST"],
    ["https://inventory.example/reservations#", "POST"],
    ["not a url", "POST"],
  ])
    await expect(
      httpv.query(url!, { ...local, method: method! }),
    ).rejects.toMatchObject({ reason: "unavailable" });
  await expect(
    httpv.query("http://localhost/r", { method: "POST" }),
  ).rejects.toThrow("HTTPS");
  // None of these reached the network; loopback with permission does.
  expect(sent).toEqual([]);
  for (const url of [
    "http://localhost/r",
    "http://[::1]/r",
    "http://127.0.0.2/r",
  ])
    await httpv.query(url, local).catch(() => {});
  expect(sent.map(String)).toEqual([
    "http://localhost/r",
    "http://[::1]/r",
    "http://127.0.0.2/r",
  ]);
});

test("providers run per request, and a failing one makes the resource unavailable", async () => {
  let current: unknown = v1;
  using app = listen(() => current as typeof v1);
  const httpv = createHTTPV();
  expect(await httpv.query(app.url, local)).toEqual(v1);
  current = v3;
  expect(await httpv.query(app.url, local)).toEqual(v3);
  current = malformed;
  const failed = await ask(app.url, MEDIA_TYPE);
  expect(failed.status).toBe(503);
  expect(failed.headers.get("content-type")).not.toBe(MEDIA_TYPE);
  await expect(httpv.query(app.url, local)).rejects.toMatchObject({
    reason: "unavailable",
  });
});

test("routes and static certificates are validated at startup", () => {
  const fetch = () => new Response();
  for (const route of [
    "POST",
    "POST reservations",
    "POST /a?b",
    "POST /a b",
    "POST /*",
    "POST /café",
    "POST /a/../b",
    "POST //x",
    "BAD() /a",
  ])
    expect(() => serve({ routes: { [route]: v1 }, fetch })).toThrow();
  for (const certificate of [malformed, { ...v1, source: "file:///etc/x" }])
    expect(() =>
      serve({ routes: { "POST /a": certificate as typeof v1 }, fetch }),
    ).toThrow();
  expect(() =>
    serve({ routes: { "POST /a": v1, "post /a": v1 }, fetch }),
  ).toThrow("duplicate");
});

test("discovery accepts only the closed httpv/1 envelope", async () => {
  for (const body of [
    { certificates: { POST: v1 } },
    { format: "httpv/2", certificates: { POST: v1 } },
    { format: "httpv/1", certificates: { POST: v1 }, extra: 1 },
    { format: "httpv/1", contracts: { POST: v1 } },
    { format: "httpv/1", certificates: { POST: malformed } },
  ])
    await expect(
      respond(body).query("https://example.test/r", { method: "POST" }),
    ).rejects.toMatchObject({ reason: "invalid-advertisement" });
});

test("responses are classified as SPEC 4.3 says", async () => {
  // A valid envelope padded to exactly 64 KiB is read; one byte more is not.
  const sent: RequestInit[] = [];
  const padded = (size: number) =>
    createHTTPV({
      fetch: async (_url, init) => {
        sent.push(init);
        const body = JSON.stringify({
          format: "httpv/1",
          certificates: { POST: v1 },
        });
        return new Response(body.padEnd(size), {
          headers: { "content-type": MEDIA_TYPE },
        });
      },
    });
  expect(
    await padded(64 * 1024).query("https://example.test/r", {
      method: "POST",
    }),
  ).toEqual(v1);
  await expect(
    padded(64 * 1024 + 1).query("https://example.test/r", { method: "POST" }),
  ).rejects.toMatchObject({ reason: "invalid-advertisement" });
  expect(sent[0]).toMatchObject({
    method: "OPTIONS",
    cache: "no-store",
    redirect: "error",
    headers: { Accept: MEDIA_TYPE, "Cache-Control": "no-cache" },
  });

  const envelope = { format: "httpv/1", certificates: { POST: v1 } };
  const plainJson = createHTTPV({ fetch: async () => Response.json(envelope) });
  await expect(
    plainJson.query("https://example.test/r", { method: "POST" }),
  ).rejects.toMatchObject({ reason: "missing-certificate" });
  // A method the envelope does not list, even one Object.prototype has.
  await expect(
    respond(envelope).query("https://example.test/r", {
      method: "constructor",
    }),
  ).rejects.toMatchObject({ reason: "missing-certificate" });
  // Invalid UTF-8 is rejected even where lenient decoding would get by: in
  // the name of a method the client would otherwise ignore.
  const json = new TextEncoder().encode(
    JSON.stringify({ format: "httpv/1", certificates: { "X?": v1, POST: v1 } }),
  );
  json[json.indexOf(0x3f)] = 0xff;
  const latin1 = createHTTPV({
    fetch: async () =>
      new Response(json, { headers: { "content-type": MEDIA_TYPE } }),
  });
  await expect(
    latin1.query("https://example.test/r", { method: "POST" }),
  ).rejects.toMatchObject({ reason: "invalid-advertisement" });
  for (const [status, reason] of [
    [503, "unavailable"],
    [400, "unavailable"],
    [404, "missing-certificate"],
    [405, "missing-certificate"],
    [406, "missing-certificate"],
    [501, "missing-certificate"],
    [203, "invalid-advertisement"],
  ] as const)
    await expect(
      respond(envelope, { status }).query("https://example.test/r", {
        method: "POST",
      }),
    ).rejects.toMatchObject({ reason });

  // A connection that fails mid-body is a transport error, not bad content,
  // whether or not the response was one HTTPV reads.
  for (const status of [200, 503]) {
    const broken = createHTTPV({
      fetch: async () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              controller.error(new Error("connection reset"));
            },
          }),
          { status, headers: { "content-type": MEDIA_TYPE } },
        ),
    });
    await expect(
      broken.query("https://example.test/r", { method: "POST" }),
    ).rejects.toMatchObject({ reason: "unavailable" });
  }
});

test("only an explicit media range with a valid non-zero weight is discovery", async () => {
  using app = listen(v1);
  const media = async (accept: string, extra?: HeadersInit) =>
    (await ask(app.url, accept, extra)).headers.get("content-type");
  for (const accept of [
    MEDIA_TYPE,
    `text/html, ${MEDIA_TYPE};q=0.001`,
    `${MEDIA_TYPE} ; q=1.0`,
    "APPLICATION/HTTPV+JSON;Q=1",
    `${MEDIA_TYPE};`,
    `${MEDIA_TYPE}, text/plain;x="a\\"b"`,
  ])
    expect(await media(accept)).toBe(MEDIA_TYPE);
  for (const accept of [
    "*/*",
    "application/*",
    `${MEDIA_TYPE};q=0, */*`,
    `${MEDIA_TYPE};q=0.000`,
    `${MEDIA_TYPE};q=abc`,
    `${MEDIA_TYPE};q=2`,
    `${MEDIA_TYPE}; q = 0.5`,
    `${MEDIA_TYPE};v=1`,
    `${MEDIA_TYPE};q=1;v=1`,
    `text/plain;x=",${MEDIA_TYPE},"`,
    `text/plain;x="a, ${MEDIA_TYPE}, \\""`,
  ])
    expect(await media(accept)).not.toBe(MEDIA_TYPE);
  // A CORS preflight is the application's to answer.
  expect(
    await media(MEDIA_TYPE, { "Access-Control-Request-Method": "POST" }),
  ).not.toBe(MEDIA_TYPE);
});

test("a method named __proto__ is still advertised", async () => {
  const app = serve({
    routes: { "__proto__ /r": v1 },
    fetch: () => new Response(),
  });
  const httpv = createHTTPV({
    fetch: async (url, init) => app.fetch(new Request(url, init)),
  });
  expect(
    await httpv.query("https://example.test/r", { method: "__proto__" }),
  ).toEqual(v1);
});

test("a caller's signal cancels discovery without removing the timeout", async () => {
  const hanging = createHTTPV({
    fetch: (_url, init) =>
      new Promise((_, reject) =>
        init.signal!.addEventListener("abort", () =>
          reject(init.signal!.reason),
        ),
      ),
  });
  const hung = () => Bun.sleep(1000).then(() => "hung");
  const cancel = new AbortController();
  setTimeout(() => cancel.abort(), 10);
  const cancelled = hanging.query("https://example.test/r", {
    method: "POST",
    signal: cancel.signal,
    timeout: 10_000,
  });
  expect(
    await Promise.race([cancelled.catch((error) => error), hung()]),
  ).toMatchObject({ reason: "unavailable" });
  const timedOut = hanging.query("https://example.test/r", {
    method: "POST",
    signal: new AbortController().signal,
    timeout: 50,
  });
  expect(
    await Promise.race([timedOut.catch((error) => error), hung()]),
  ).toMatchObject({ reason: "unavailable" });
});

test("check() reports why discovery failed, for any method spelling", async () => {
  const dependency = (url: string) => ({
    url,
    method: "post",
    requirements: inventory().exact,
    axioms: {},
  });
  const answering = (body: unknown, status = 200) =>
    createHTTPV({
      fetch: async () =>
        Response.json(body, {
          status,
          headers: { "content-type": MEDIA_TYPE },
        }),
    });
  const url = "https://example.test/r";
  expect(await answering({}, 404).check(dependency(url))).toMatchObject({
    status: "unknown",
    reason: "missing-certificate",
  });
  expect(
    await answering({
      format: "httpv/1",
      certificates: { POST: malformed },
    }).check(dependency(url)),
  ).toMatchObject({ status: "unknown", reason: "invalid-advertisement" });
  // "post" is looked up as POST: the certificate is found and judged, here
  // against a policy that accepts none of its axioms.
  expect(
    await answering({
      format: "httpv/1",
      certificates: { POST: v1 },
    }).check(dependency(url)),
  ).toMatchObject({ status: "unknown", reason: "forbidden-axiom" });
  for (const bad of [
    "http://127.0.0.1.evil.example/r",
    "https://:pw@example.test/r",
  ])
    expect(
      await answering({}).check({
        ...dependency(bad),
        allowInsecureHttp: true,
      }),
    ).toMatchObject({ status: "unknown", reason: "unavailable" });
});
