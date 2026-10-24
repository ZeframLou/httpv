import { expect, test } from "bun:test";
import { createHTTPV } from "../src/index.ts";
import { testAuthority, inventoryAxioms, advertise } from "./helpers.ts";

async function setup() {
  const authority = testAuthority();
  const [v1, v3] = await Promise.all([
    authority.issue("v1"),
    authority.issue("v3"),
  ]);
  let current = v1;
  const httpv = createHTTPV({ backend: authority.backend });
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    ...httpv.serve({
      routes: { "POST /reservations": () => advertise(current) },
      fetch: () => new Response("ok"),
    }),
  });
  const options = {
    operation: "Inventory.POST_reservations",
    url: `http://127.0.0.1:${server.port}/reservations`,
    method: "POST",
    allowInsecureHttp: true,
    requirements: { format: "zklean/requirements/1" as const, specs: v1.specs },
    allowedAxioms: inventoryAxioms,
    mode: "exact" as const,
    interval: 60_000,
  };
  return {
    authority,
    v1,
    v3,
    httpv,
    server,
    options,
    upgrade() {
      current = v3;
    },
  };
}

test("gating follows current contracts and rejects stopped monitors", async () => {
  const app = await setup();
  const monitor = app.httpv.watch(app.options);
  try {
    expect(() => monitor.requireVerified()).toThrow();
    expect((await monitor.refresh()).status).toBe("verified");
    expect(monitor.requireVerified().status).toBe("verified");
    app.upgrade();
    expect((await monitor.refresh()).status).toBe("incompatible");
    expect(() => monitor.requireVerified()).toThrow();
    monitor.stop();
    expect((await monitor.refresh()).reason).toBe("stopped");
    expect(() => monitor.requireVerified()).toThrow();
  } finally {
    monitor.stop();
    app.server.stop(true);
  }
});

test("async state callbacks are rejected instead of racing newer policy decisions", async () => {
  const app = await setup();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const errors: unknown[] = [];
  const monitor = app.httpv.watch({
    ...app.options,
    // @ts-expect-error State notifications must be synchronous, including in TS consumers.
    async onChange() {
      await gate;
    },
    onError(error) {
      errors.push(error);
    },
  });
  try {
    expect((await monitor.refresh()).reason).toBe("callback-error");
    app.upgrade();
    expect((await monitor.refresh()).status).toBe("unknown");
    expect(() => monitor.requireVerified()).toThrow();
    expect(errors).toHaveLength(1);
  } finally {
    release();
    monitor.stop();
    app.server.stop(true);
  }
});

test("verified state expires even while a later verifier is stalled", async () => {
  const app = await setup();
  let hang = false;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const client = createHTTPV({
    backend: {
      identity: app.authority.backend.identity,
      async verify(certificate) {
        if (hang) await gate;
        return app.authority.backend.verify(certificate);
      },
    },
  });
  const monitor = client.watch({
    ...app.options,
    timeout: 600,
    maxAge: 50,
  });
  try {
    expect((await monitor.refresh()).status).toBe("verified");
    hang = true;
    app.upgrade();
    const refresh = monitor.refresh();
    await Bun.sleep(100);
    expect(monitor.current?.status).toBe("unknown");
    expect(() => monitor.requireVerified()).toThrow();
    expect((await refresh).reason).toBe("timeout");
    release();
    await Bun.sleep(100);
    expect(monitor.current?.status).toBe("unknown");
  } finally {
    release();
    monitor.stop();
    app.server.stop(true);
  }
});
