import { expect, test } from "bun:test";
import { createHTTPV, MEDIA_TYPE } from "../src/index.ts";
import type { Certificate, ProofBackend, Result } from "../src/index.ts";
import { axioms, gate, inventory, listen, slow } from "./helpers.ts";

/** A local server for the inventory story, and a dependency on it. */
function setup() {
  const fixtures = inventory();
  let current = fixtures.v1;
  /** When each discovery request arrived. */
  const served: number[] = [];
  const app = listen(() => {
    served.push(performance.now());
    return current;
  });
  return {
    ...fixtures,
    app,
    served,
    dependency: {
      url: app.url,
      method: "POST",
      allowInsecureHttp: true,
      requirements: fixtures.exact,
      axioms,
    },
    publish(certificate: Certificate) {
      current = certificate;
    },
  };
}

const client = (backend: ProofBackend) => createHTTPV({ backend });

test("requireVerified follows the current certificate and stops with the monitor", async () => {
  const { backend, app, dependency, publish, v2, v3 } = setup();
  using _ = app;
  const changes: Result[] = [];
  const monitor = client(backend).watch(dependency, {
    interval: 60_000,
    onChange: (result) => changes.push(result),
  });
  expect(() => monitor.requireVerified()).toThrow("unchecked");
  expect((await monitor.refresh()).status).toBe("verified");
  expect(monitor.requireVerified().reason).toBe("exact-match");
  await monitor.refresh();
  publish(v2);
  await monitor.refresh();
  publish(v3);
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
});

test("expiry is notified, and so is recovery with the same certificate", async () => {
  const { backend, app, dependency } = setup();
  using _ = app;
  const reasons: string[] = [];
  const monitor = client(backend).watch(dependency, {
    interval: 60_000,
    maxAge: 500,
    onChange: (result) => reasons.push(result.reason),
  });
  try {
    await monitor.refresh();
    await Bun.sleep(700);
    await monitor.refresh();
    expect(reasons).toEqual(["exact-match", "expired", "exact-match"]);
  } finally {
    monitor.stop();
  }
});

test("a result's age counts from its request, so a slow check can arrive expired", async () => {
  const { backend, app, dependency } = setup();
  using _ = app;
  const started = Date.now();
  const reasons: string[] = [];
  const monitor = client(slow(backend, () => Bun.sleep(100))).watch(
    dependency,
    {
      interval: 60_000,
      maxAge: 50,
      onChange: (result) => reasons.push(result.reason),
    },
  );
  try {
    const result = await monitor.refresh();
    expect(result).toMatchObject({ status: "unknown", reason: "expired" });
    expect(result.checkedAt!).toBeLessThan(started + 50);
    expect(reasons).toEqual(["expired"]);
  } finally {
    monitor.stop();
  }
});

test("checks start at a fixed rate", async () => {
  const env = setup();
  using _ = env.app;
  const monitor = client(slow(env.backend, () => Bun.sleep(200))).watch(
    env.dependency,
    { interval: 400 },
  );
  try {
    // Fixed rate: the second check starts 400 ms after the first; waiting for
    // the first to finish would start it 600 ms after.
    await Bun.sleep(550);
    const [first, second] = env.served;
    expect(second! - first!).toBeLessThan(500);
  } finally {
    monitor.stop();
  }
});

test("a verified result expires while a later check stalls, and the stalled check times out", async () => {
  const { backend, app, dependency, publish, v2 } = setup();
  using _ = app;
  const stall = gate();
  let hang = false;
  const monitor = client(slow(backend, () => hang && stall.closed)).watch(
    dependency,
    { interval: 60_000, timeout: 600, maxAge: 200 },
  );
  try {
    expect((await monitor.refresh()).status).toBe("verified");
    hang = true;
    publish(v2);
    const refresh = monitor.refresh();
    await Bun.sleep(300);
    expect(monitor.current?.reason).toBe("expired");
    expect(() => monitor.requireVerified()).toThrow("expired");
    expect((await refresh).reason).toBe("timeout");
    stall.open();
    await Bun.sleep(50);
    expect(monitor.current?.reason).toBe("timeout");
  } finally {
    stall.open();
    monitor.stop();
  }
});

test("a check that blocks past its timeout is discarded even if it finishes first", async () => {
  const { backend, app, dependency } = setup();
  using _ = app;
  const blocking: ProofBackend = {
    identity: backend.identity,
    async verify(certificate) {
      const valid = await backend.verify(certificate);
      const until = Date.now() + 400;
      while (Date.now() < until);
      return valid;
    },
  };
  const monitor = client(blocking).watch(dependency, {
    interval: 60_000,
    timeout: 200,
  });
  try {
    expect((await monitor.refresh()).reason).toBe("timeout");
    expect(() => monitor.requireVerified()).toThrow("timeout");
  } finally {
    monitor.stop();
  }
});

test("a check abandoned at its timeout finishes before the next one starts", async () => {
  const { backend, app, dependency, publish, served, v2 } = setup();
  using _ = app;
  const stall = gate();
  // A transport that ignores cancellation, so an abandoned check that started
  // would reach the server.
  const monitor = createHTTPV({
    backend: slow(backend, () => stall.closed),
    fetch: (url, init) => fetch(url, { ...init, signal: null }),
  }).watch(dependency, { interval: 60_000, timeout: 50 });
  try {
    expect((await monitor.refresh()).reason).toBe("timeout");
    // A different certificate, so the verifier's cache cannot merge the work.
    publish(v2);
    expect((await monitor.refresh()).reason).toBe("timeout");
    expect((await monitor.refresh()).reason).toBe("timeout");
    stall.open();
    await Bun.sleep(50);
    // The checks abandoned while waiting never started.
    expect(served.length).toBe(1);
    expect((await monitor.refresh()).status).toBe("verified");
    expect(served.length).toBe(2);
    monitor.stop();
    expect((await monitor.refresh()).reason).toBe("stopped");
    expect(served.length).toBe(2);
  } finally {
    stall.open();
    monitor.stop();
  }
});

test("stopping during a check reports stopped", async () => {
  const { backend, app, dependency } = setup();
  using _ = app;
  const stall = gate();
  const monitor = client(slow(backend, () => stall.closed)).watch(dependency, {
    interval: 60_000,
  });
  const pending = monitor.refresh();
  monitor.stop();
  stall.open();
  expect((await pending).reason).toBe("stopped");
  expect(monitor.current?.reason).toBe("stopped");
});

test("polling reports an unavailable dependency and stops on an external signal", async () => {
  const { backend, v1, dependency } = inventoryDependency();
  let calls = 0;
  const flaky = createHTTPV({
    backend,
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
    flaky.watch(dependency, {
      interval: 10,
      signal: controller.signal,
      onChange(result) {
        statuses.push(`${result.status}/${result.reason}`);
        if (result.status === "unknown") {
          controller.abort();
          resolve();
        }
      },
    }),
  );
  await Bun.sleep(30);
  expect(statuses).toEqual(["verified/exact-match", "unknown/unavailable"]);
  expect(calls).toBe(2);

  // A signal that is already aborted stops the monitor before any check.
  calls = 0;
  const stopped = flaky.watch(dependency, {
    interval: 10,
    signal: AbortSignal.abort(),
  });
  expect((await stopped.refresh()).reason).toBe("stopped");
  expect(calls).toBe(0);
});

test("settings must be positive integers; the default maxAge always fits", () => {
  const { backend, dependency } = inventoryDependency();
  const httpv = client(backend);
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
  httpv.watch(dependency, { interval: 2 ** 31 - 1 }).stop();
});

/** A dependency for tests whose transport is not a real server. */
function inventoryDependency() {
  const fixtures = inventory();
  return {
    ...fixtures,
    dependency: {
      url: "https://example.test/reservations",
      method: "POST",
      requirements: fixtures.exact,
      axioms,
    },
  };
}

test("stopping from onChange makes the pending refresh report stopped", async () => {
  const { backend, app, dependency } = setup();
  using _ = app;
  const monitor = client(backend).watch(dependency, {
    interval: 60_000,
    onChange: () => monitor.stop(),
  });
  expect((await monitor.refresh()).reason).toBe("stopped");
});

test("expiry is notified even when a timer fires early", async () => {
  const { backend, app, dependency } = setup();
  using _ = app;
  // Fractional deadlines make timers fire a little early for some ages, so
  // try many at once.
  const runs = Array.from({ length: 40 }, (_, index) => {
    const reasons: string[] = [];
    const monitor = client(backend).watch(dependency, {
      interval: 60_000,
      maxAge: 20 + index,
      onChange: (result) => reasons.push(result.reason),
    });
    return { reasons, monitor };
  });
  await Bun.sleep(250);
  for (const { reasons, monitor } of runs) {
    monitor.stop();
    expect(reasons.at(-1)).toBe("expired");
  }
});

test("stopping from onChange is not itself notified", async () => {
  const { backend, app, dependency } = setup();
  using _ = app;
  const reasons: string[] = [];
  const monitor = client(slow(backend, () => Bun.sleep(100))).watch(
    dependency,
    {
      interval: 60_000,
      maxAge: 50,
      onChange: (result) => {
        reasons.push(result.reason);
        monitor.stop();
      },
    },
  );
  expect((await monitor.refresh()).reason).toBe("stopped");
  expect(reasons).toEqual(["expired"]);
});

test("the default maxAge covers a check that overruns the interval", async () => {
  const { backend, app, dependency } = setup();
  using _ = app;
  const reasons: string[] = [];
  // Each check takes 300 ms in discovery, which the verifier's cache cannot
  // skip, so the second lands about 600 ms after the first started: past
  // interval + timeout (450), within the default (800).
  const monitor = createHTTPV({
    backend,
    fetch: async (url, init) => {
      await Bun.sleep(300);
      return fetch(url, init);
    },
  }).watch(dependency, {
    interval: 50,
    timeout: 400,
    onChange: (result) => reasons.push(result.reason),
  });
  try {
    await Bun.sleep(1000);
    expect(reasons).toEqual(["exact-match"]);
  } finally {
    monitor.stop();
  }
});

test("a dependency changed after watch() is checked as it was", async () => {
  const { backend, app, dependency, v3 } = setup();
  using _ = app;
  const watched = structuredClone(dependency);
  const monitor = client(backend).watch(watched, { interval: 60_000 });
  watched.requirements = { ...watched.requirements, claims: v3.claims };
  try {
    expect((await monitor.refresh()).status).toBe("verified");
  } finally {
    monitor.stop();
  }
});
