import { expect, test } from "bun:test";
import { createHTTPV, MEDIA_TYPE, serve } from "../src/index.ts";
import { methodName } from "../src/protocol.ts";
import { advertise, inventory, listen } from "./helpers.ts";

const local = { method: "POST", allowInsecureHttp: true };
const { v1, v3 } = inventory();

function respond(body: unknown, init: ResponseInit = {}) {
  return createHTTPV({
    fetch: async () =>
      Response.json(body, { headers: { "content-type": MEDIA_TYPE }, ...init }),
  });
}

test("OPTIONS with the HTTPV media type returns the advertisement; other requests pass through", async () => {
  using app = listen(advertise(v1));
  const httpv = createHTTPV();
  expect(await httpv.query(app.url, local)).toEqual(advertise(v1));

  const discovery = await fetch(app.url, {
    method: "OPTIONS",
    headers: { Accept: `text/html, ${MEDIA_TYPE}; q=1` },
  });
  expect(discovery.headers.get("cache-control")).toBe("no-store");
  expect(discovery.headers.get("vary")).toBe("Accept");
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
});

test("providers run per request, so the certificate and entrypoint change together", async () => {
  let current = advertise(v1);
  using app = listen(() => current);
  const httpv = createHTTPV();
  expect(await httpv.query(app.url, local)).toEqual(advertise(v1));
  current = advertise(v3);
  expect(await httpv.query(app.url, local)).toEqual(current);
  current = advertise(v1, "Missing.operation");
  expect(
    (
      await fetch(app.url, {
        method: "OPTIONS",
        headers: { Accept: MEDIA_TYPE },
      })
    ).status,
  ).toBe(503);
});

test("routes are validated at startup", () => {
  const fetch = () => new Response();
  for (const route of ["POST", "POST reservations", "POST /a?b", "BAD() /a"])
    expect(() =>
      serve({ routes: { [route]: advertise(v1) }, fetch }),
    ).toThrow();
  expect(() =>
    serve({ routes: { "POST /a": advertise(v1, "Missing.operation") }, fetch }),
  ).toThrow("not a certified definition");
  expect(() =>
    serve({
      routes: { "POST /a": advertise(v1), "post /a": advertise(v1) },
      fetch,
    }),
  ).toThrow("duplicate");
  expect(methodName("post")).toBe("POST");
  expect(methodName("patch")).toBe("patch");
});

test("discovery accepts only the closed httpv/1 envelope", async () => {
  for (const body of [
    { certificates: { POST: v1 } },
    { format: "httpv/2", contracts: { POST: advertise(v1) } },
    { format: "httpv/1", contracts: { POST: advertise(v1) }, extra: 1 },
    { format: "httpv/1", contracts: { POST: v1 } },
    { format: "httpv/1", contracts: { POST: advertise(v1, "Missing.op") } },
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
    fetch: async () => Response.json({ format: "httpv/1", contracts: {} }),
  });
  await expect(
    plainJson.query("https://example.test/r", { method: "POST" }),
  ).rejects.toMatchObject({ reason: "missing-certificate" });
  await expect(
    respond({}, { status: 503 }).query("https://example.test/r", {
      method: "POST",
    }),
  ).rejects.toMatchObject({ reason: "unavailable" });
});

test("q=0 declines discovery, and a __proto__ method is still advertised", async () => {
  using app = listen(advertise(v1));
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
      routes: { "__proto__ /r": advertise(v1) },
      fetch: () => new Response(),
    }),
  });
  try {
    expect(
      await createHTTPV().query(`http://127.0.0.1:${server.port}/r`, {
        ...local,
        method: "__proto__",
      }),
    ).toEqual(advertise(v1));
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
