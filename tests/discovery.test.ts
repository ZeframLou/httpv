import { expect, test } from "bun:test";
import { createHTTPV, MEDIA_TYPE, serve } from "../src/index.ts";
import { methodName } from "../src/protocol.ts";
import { inventory, listen } from "./helpers.ts";

const malformed = { ...inventory().v1, extra: 1 };

const local = { method: "POST", allowInsecureHttp: true };
const { v1, v3 } = inventory();

function respond(body: unknown, init: ResponseInit = {}) {
  return createHTTPV({
    fetch: async () =>
      Response.json(body, { headers: { "content-type": MEDIA_TYPE }, ...init }),
  });
}

test("OPTIONS with the HTTPV media type returns the certificate; other requests pass through", async () => {
  using app = listen(v1);
  const httpv = createHTTPV();
  expect(await httpv.query(app.url, local)).toEqual(v1);

  const discovery = await fetch(app.url, {
    method: "OPTIONS",
    headers: { Accept: `text/html, ${MEDIA_TYPE}; q=1` },
  });
  expect(discovery.headers.get("cache-control")).toBe("no-store");
  for (const method of ["POST", "OPTIONS"])
    expect(await fetch(app.url, { method }).then((r) => r.json())).toEqual({
      method,
    });

  await expect(
    httpv.query(app.url, { ...local, method: "GET" }),
  ).rejects.toMatchObject({ reason: "missing-certificate" });
  await expect(
    httpv.query(app.url.replace("reservations", "other"), local),
  ).rejects.toMatchObject({ reason: "missing-certificate" });
  await expect(httpv.query(app.url, { method: "POST" })).rejects.toThrow(
    "HTTPS",
  );
  // Plain HTTP is for a server on this machine only.
  await expect(
    httpv.query("http://inventory.example/reservations", local),
  ).rejects.toThrow("loopback");
});

test("a resource without certificates gets the application's OPTIONS response", async () => {
  using app = listen(v1);
  const response = await fetch(app.url.replace("reservations", "other"), {
    method: "OPTIONS",
    headers: { Accept: MEDIA_TYPE },
  });
  expect(await response.json()).toEqual({ method: "OPTIONS" });
});

test("providers run per request", async () => {
  let current = v1;
  using app = listen(() => current);
  const httpv = createHTTPV();
  expect(await httpv.query(app.url, local)).toEqual(v1);
  current = v3;
  expect(await httpv.query(app.url, local)).toEqual(current);
  current = malformed;
  const failed = await fetch(app.url, {
    method: "OPTIONS",
    headers: { Accept: MEDIA_TYPE },
  });
  expect(failed.status).toBe(503);
  expect(failed.headers.get("content-type")).not.toBe(MEDIA_TYPE);
  await expect(httpv.query(app.url, local)).rejects.toMatchObject({
    reason: "unavailable",
  });
});

test("routes are validated at startup", () => {
  const fetch = () => new Response();
  for (const route of [
    "POST",
    "POST reservations",
    "POST /a?b",
    "POST /*",
    "BAD() /a",
  ])
    expect(() => serve({ routes: { [route]: v1 }, fetch })).toThrow();
  expect(() => serve({ routes: { "POST /a": malformed }, fetch })).toThrow();
  expect(() =>
    serve({
      routes: { "POST /a": v1, "post /a": v1 },
      fetch,
    }),
  ).toThrow("duplicate");
  expect(methodName("post")).toBe("POST");
  expect(methodName("patch")).toBe("patch");
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

test("discovery refuses redirects, wrong media types, failures and oversized bodies", async () => {
  const sent: RequestInit[] = [];
  const oversized = createHTTPV({
    maxResponseBytes: 30,
    fetch: async (_url, init) => {
      sent.push(init);
      return new Response("x".repeat(31), {
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

  const plainJson = createHTTPV({
    fetch: async () => Response.json({ format: "httpv/1", certificates: {} }),
  });
  await expect(
    plainJson.query("https://example.test/r", { method: "POST" }),
  ).rejects.toMatchObject({ reason: "missing-certificate" });
  for (const [status, reason] of [
    [503, "unavailable"],
    [406, "missing-certificate"],
    [203, "invalid-advertisement"],
  ] as const)
    await expect(
      respond(
        { format: "httpv/1", certificates: { POST: v1 } },
        { status },
      ).query("https://example.test/r", { method: "POST" }),
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
});

test("only an explicit media range with a valid non-zero quality is discovery", async () => {
  using app = listen(v1);
  const media = async (accept: string) =>
    (
      await fetch(app.url, { method: "OPTIONS", headers: { Accept: accept } })
    ).headers.get("content-type");
  for (const accept of [
    `${MEDIA_TYPE}`,
    `${MEDIA_TYPE};q=0.001`,
    `${MEDIA_TYPE};q=1.0`,
  ])
    expect(await media(accept)).toBe(MEDIA_TYPE);
  for (const accept of [
    "*/*",
    "application/*",
    `${MEDIA_TYPE};q=abc`,
    `${MEDIA_TYPE};q=2`,
    `${MEDIA_TYPE};q=0.000`,
    `${MEDIA_TYPE}; q = 0.5`,
    `${MEDIA_TYPE};v=1`,
  ])
    expect(await media(accept)).not.toBe(MEDIA_TYPE);
});

test("q=0 and CORS preflights reach the application; a __proto__ method is still advertised", async () => {
  using app = listen(v1);
  expect(
    await fetch(app.url, {
      method: "OPTIONS",
      headers: {
        Accept: MEDIA_TYPE,
        Origin: "https://client.example",
        "Access-Control-Request-Method": "POST",
      },
    }).then((r) => r.json()),
  ).toEqual({ method: "OPTIONS" });
  for (const accept of [`${MEDIA_TYPE};q=0, */*`, `${MEDIA_TYPE}; q = 0.000`])
    expect(
      await fetch(app.url, {
        method: "OPTIONS",
        headers: { Accept: accept },
      }).then((r) => r.json()),
    ).toEqual({ method: "OPTIONS" });

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    ...serve({
      routes: { "__proto__ /r": v1 },
      fetch: () => new Response(),
    }),
  });
  try {
    expect(
      await createHTTPV().query(`http://127.0.0.1:${server.port}/r`, {
        ...local,
        method: "__proto__",
      }),
    ).toEqual(v1);
  } finally {
    server.stop(true);
  }
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
  const started = Date.now();
  const query = hanging.query("https://example.test/r", {
    method: "POST",
    signal: new AbortController().signal,
    timeout: 50,
  });
  const hung = Bun.sleep(1000).then(() => "hung");
  expect(
    await Promise.race([query.catch((error) => error), hung]),
  ).toMatchObject({ reason: "unavailable" });
  expect(Date.now() - started).toBeLessThan(1000);
  for (const maxResponseBytes of [Number.NaN, Infinity, 0])
    expect(() => createHTTPV({ maxResponseBytes })).toThrow(RangeError);
});
