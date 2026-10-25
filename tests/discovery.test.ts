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
  for (const method of ["POST", "OPTIONS"])
    expect(await fetch(app.url, { method }).then((r) => r.json())).toEqual({
      method,
    });
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
  using app = listen(v1);
  const httpv = createHTTPV();
  await expect(httpv.query(app.url, { method: "POST" })).rejects.toThrow(
    "HTTPS",
  );
  for (const [url, method] of [
    ["http://inventory.example/reservations", "POST"],
    ["https://user@inventory.example/reservations", "POST"],
    ["https://inventory.example/reservations#", "POST"],
    ["not a url", "POST"],
    [app.url, "BAD()"],
  ])
    await expect(
      httpv.query(url!, { ...local, method: method! }),
    ).rejects.toMatchObject({ reason: "unavailable" });
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
  const sent: RequestInit[] = [];
  const oversized = createHTTPV({
    fetch: async (_url, init) => {
      sent.push(init);
      return new Response("x".repeat(64 * 1024 + 1), {
        headers: { "content-type": MEDIA_TYPE },
      });
    },
  });
  await expect(
    oversized.query("https://example.test/r", { method: "POST" }),
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
  for (const [status, reason] of [
    [503, "unavailable"],
    [406, "missing-certificate"],
    [203, "invalid-advertisement"],
  ] as const)
    await expect(
      respond(envelope, { status }).query("https://example.test/r", {
        method: "POST",
      }),
    ).rejects.toMatchObject({ reason });

  // A connection that fails mid-body is a transport error, not bad content.
  const broken = createHTTPV({
    fetch: async () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            controller.error(new Error("connection reset"));
          },
        }),
        { headers: { "content-type": MEDIA_TYPE } },
      ),
  });
  await expect(
    broken.query("https://example.test/r", { method: "POST" }),
  ).rejects.toMatchObject({ reason: "unavailable" });

  for (const maxResponseBytes of [Number.NaN, Infinity, 0, 1024])
    expect(() => createHTTPV({ maxResponseBytes })).toThrow(RangeError);
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

test("a caller's signal does not remove the discovery timeout", async () => {
  const hanging = createHTTPV({
    fetch: (_url, init) =>
      new Promise((_, reject) =>
        init.signal!.addEventListener("abort", () =>
          reject(init.signal!.reason),
        ),
      ),
  });
  const query = hanging.query("https://example.test/r", {
    method: "POST",
    signal: new AbortController().signal,
    timeout: 50,
  });
  const hung = Bun.sleep(1000).then(() => "hung");
  expect(
    await Promise.race([query.catch((error) => error), hung]),
  ).toMatchObject({ reason: "unavailable" });
});
