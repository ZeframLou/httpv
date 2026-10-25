import { expect, test } from "bun:test";
import { createHTTPV, MEDIA_TYPE } from "../src/index.ts";
import type { Result } from "../src/index.ts";
import { axioms, inventory, listen } from "./helpers.ts";

function setup() {
  const fixtures = inventory();
  const versions = [fixtures.v1, fixtures.v2, fixtures.v3];
  let current = fixtures.v1;
  const app = listen(() => current);
  const dependency = {
    url: app.url,
    method: "POST",
    allowInsecureHttp: true,
    requirements: fixtures.exact,
    axioms,
  };
  return {
    authority: fixtures.authority,
    v1: fixtures.v1,
    app,
    dependency,
    serveVersion(index: number) {
      current = versions[index]!;
    },
  };
}

test("requireVerified follows the current contract and stops with the monitor", async () => {
  const { authority, app, dependency, serveVersion } = setup();
  using _ = app;
  const changes: Result[] = [];
  const monitor = createHTTPV({ backend: authority.backend }).watch(
    dependency,
    { interval: 60_000, onChange: (result) => changes.push(result) },
  );
  try {
    expect(() => monitor.requireVerified()).toThrow("unchecked");
    expect((await monitor.refresh()).status).toBe("verified");
    expect(monitor.requireVerified().reason).toBe("exact-match");
    await monitor.refresh();
    serveVersion(1);
    await monitor.refresh();
    serveVersion(2);
    const [a, b] = [monitor.refresh(), monitor.refresh()];
    expect(a).toBe(b);
    expect((await a).status).toBe("incompatible");
    expect(() => monitor.requireVerified()).toThrow("requirements-not-met");
    // Unchanged results are not repeated; a new certificate is a change.
    expect(changes.map((r) => r.status)).toEqual([
      "verified",
      "verified",
      "incompatible",
    ]);
    monitor.stop();
    expect((await monitor.refresh()).reason).toBe("stopped");
    expect(monitor.current?.reason).toBe("stopped");
  } finally {
    monitor.stop();
  }
});

test("a verified result expires while a later check stalls, and the stalled check times out", async () => {
  const { authority, app, dependency, serveVersion } = setup();
  using _ = app;
  let release!: () => void;
  const stall = new Promise<void>((resolve) => (release = resolve));
  let hang = false;
  const monitor = createHTTPV({
    backend: {
      identity: authority.backend.identity,
      async verify(certificate) {
        if (hang) await stall;
        return authority.backend.verify(certificate);
      },
    },
  }).watch(dependency, { interval: 60_000, timeout: 300, maxAge: 50 });
  try {
    expect((await monitor.refresh()).status).toBe("verified");
    hang = true;
    serveVersion(1);
    const refresh = monitor.refresh();
    await Bun.sleep(100);
    expect(monitor.current?.reason).toBe("expired");
    expect(() => monitor.requireVerified()).toThrow("expired");
    expect((await refresh).reason).toBe("timeout");
    release();
    await Bun.sleep(50);
    expect(monitor.current?.reason).toBe("timeout");
  } finally {
    release();
    monitor.stop();
  }
});

test("polling reports an unavailable dependency and stops on an external signal", async () => {
  const { authority, dependency, v1, app } = setup();
  app[Symbol.dispose]();
  let calls = 0;
  const client = createHTTPV({
    backend: authority.backend,
    fetch: async () =>
      ++calls === 1
        ? Response.json(
            { format: "httpv/1", certificates: { POST: v1 } },
            { headers: { "content-type": MEDIA_TYPE } },
          )
        : new Response("offline", { status: 503 }),
  });
  const controller = new AbortController();
  const statuses: string[] = [];
  await new Promise<void>((resolve) =>
    client.watch(
      { ...dependency, url: "https://example.test/reservations" },
      {
        interval: 10,
        signal: controller.signal,
        onChange(result) {
          statuses.push(`${result.status}/${result.reason}`);
          if (result.status === "unknown") {
            controller.abort();
            resolve();
          }
        },
      },
    ),
  );
  await Bun.sleep(30);
  expect(statuses).toEqual(["verified/exact-match", "unknown/unavailable"]);
  expect(calls).toBe(2);
});

test("expiry is notified, and so is recovery with the same certificate", async () => {
  const { authority, app, dependency } = setup();
  using _ = app;
  const reasons: string[] = [];
  const monitor = createHTTPV({ backend: authority.backend }).watch(
    dependency,
    {
      interval: 60_000,
      maxAge: 50,
      onChange: (result) => reasons.push(result.reason),
    },
  );
  try {
    await monitor.refresh();
    await Bun.sleep(100);
    await monitor.refresh();
    expect(reasons).toEqual(["exact-match", "expired", "exact-match"]);
  } finally {
    monitor.stop();
  }
});

test("a check that blocks past its timeout is discarded even if it finishes first", async () => {
  const { authority, app, dependency } = setup();
  using _ = app;
  const monitor = createHTTPV({
    backend: {
      identity: authority.backend.identity,
      async verify(certificate) {
        const valid = await authority.backend.verify(certificate);
        const until = Date.now() + 400;
        while (Date.now() < until);
        return valid;
      },
    },
  }).watch(dependency, { interval: 60_000, timeout: 200 });
  try {
    expect((await monitor.refresh()).reason).toBe("timeout");
    expect(() => monitor.requireVerified()).toThrow("timeout");
  } finally {
    monitor.stop();
  }
});

test("stopping during a check reports stopped", async () => {
  const { authority, app, dependency } = setup();
  using _ = app;
  let release!: () => void;
  const stall = new Promise<void>((resolve) => (release = resolve));
  const monitor = createHTTPV({
    backend: {
      identity: authority.backend.identity,
      async verify(certificate) {
        await stall;
        return authority.backend.verify(certificate);
      },
    },
  }).watch(dependency, { interval: 60_000 });
  const pending = monitor.refresh();
  monitor.stop();
  release();
  expect((await pending).reason).toBe("stopped");
  expect(monitor.current?.reason).toBe("stopped");
});

test("settings must be positive integers", async () => {
  const { authority, app, dependency } = setup();
  using _ = app;
  const httpv = createHTTPV({ backend: authority.backend });
  for (const settings of [
    { interval: "1000" },
    { interval: 0 },
    { interval: 1000, timeout: Number.NaN },
    { interval: 1000, maxAge: 1.5 },
    { interval: 2 ** 31 },
  ])
    expect(() =>
      httpv.watch(dependency, settings as unknown as { interval: number }),
    ).toThrow(RangeError);
});

test("a check abandoned at its timeout finishes before the next one starts", async () => {
  const { authority, app, dependency, serveVersion } = setup();
  using _ = app;
  let calls = 0;
  let release!: () => void;
  const stall = new Promise<void>((resolve) => (release = resolve));
  const monitor = createHTTPV({
    backend: {
      identity: authority.backend.identity,
      async verify(certificate) {
        calls++;
        await stall;
        return authority.backend.verify(certificate);
      },
    },
  }).watch(dependency, { interval: 60_000, timeout: 50 });
  try {
    expect((await monitor.refresh()).reason).toBe("timeout");
    // A different certificate, so the verifier's cache cannot merge the work.
    serveVersion(1);
    expect((await monitor.refresh()).reason).toBe("timeout");
    expect((await monitor.refresh()).reason).toBe("timeout");
    expect(calls).toBe(1);
    release();
    await Bun.sleep(20);
    // The checks abandoned while waiting never started.
    expect(calls).toBe(1);
    expect((await monitor.refresh()).status).toBe("verified");
    expect(calls).toBe(2);
    monitor.stop();
    expect((await monitor.refresh()).reason).toBe("stopped");
    expect(calls).toBe(2);
  } finally {
    release();
    monitor.stop();
  }
});

test("a result's age counts from the request that produced it", async () => {
  const { authority, app, dependency } = setup();
  using _ = app;
  const started = Date.now();
  const monitor = createHTTPV({
    backend: {
      identity: authority.backend.identity,
      async verify(certificate) {
        await Bun.sleep(100);
        return authority.backend.verify(certificate);
      },
    },
  }).watch(dependency, { interval: 60_000 });
  try {
    const result = await monitor.refresh();
    expect(result.status).toBe("verified");
    expect(result.checkedAt!).toBeLessThan(started + 50);
  } finally {
    monitor.stop();
  }
});
