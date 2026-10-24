import { expect, test } from "bun:test";
import { createHTTPV, MEDIA_TYPE } from "../src/index.ts";
import type { Result } from "../src/index.ts";
import {
  advertise,
  inventoryAxioms,
  listen,
  operation,
  snapshot,
  testAuthority,
} from "./helpers.ts";

async function setup() {
  const authority = testAuthority();
  const [v1, v2, v3] = await Promise.all(
    ["v1", "v2", "v3"].map((name) => authority.issue(name)),
  );
  let current = v1!;
  const app = listen(() => advertise(current));
  const dependency = {
    url: app.url,
    method: "POST",
    allowInsecureHttp: true,
    operation,
    requirements: snapshot(v1!),
    allowedAxioms: inventoryAxioms,
  };
  return {
    authority,
    app,
    dependency,
    serveVersion(index: number) {
      current = [v1, v2, v3][index]!;
    },
  };
}

test("requireVerified follows the current contract and stops with the monitor", async () => {
  const { authority, app, dependency, serveVersion } = await setup();
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
    expect(() => monitor.requireVerified()).toThrow("operation-mismatch");
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
  const { authority, app, dependency, serveVersion } = await setup();
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
  const { authority, dependency } = await setup();
  const v1 = await authority.issue("v1");
  let calls = 0;
  const client = createHTTPV({
    backend: authority.backend,
    fetch: async () =>
      ++calls === 1
        ? Response.json(
            { format: "httpv/1", contracts: { POST: advertise(v1) } },
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
