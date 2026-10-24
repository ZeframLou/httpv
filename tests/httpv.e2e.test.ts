import { advertise } from "./helpers.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { createHTTPV, DiscoveryError } from "../src/client.ts";
import { canonical, encodeBase64, readModel, sha256 } from "zklean/encoding";
import { declarationIdentity } from "zklean";
import { MEDIA_TYPE, methodName } from "../src/server.ts";
import { inventoryAxioms, requirements, testAuthority } from "./helpers.ts";
import type { Certificate, Monitor, VerificationResult } from "../src/types.ts";

const authority = testAuthority();
let v1: Certificate, v2: Certificate, v3: Certificate, bridge: Certificate;
let current: Certificate;
let discoveryCount = 0;
const adapter = createHTTPV().serve({
  routes: {
    "POST /reservations": () => {
      discoveryCount++;
      return advertise(current);
    },
  },
  fetch: (request) =>
    Response.json({
      method: request.method,
      path: new URL(request.url).pathname,
    }),
});
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, ...adapter });
const url = `http://127.0.0.1:${server.port}/reservations`;
const local = { method: "POST", allowInsecureHttp: true };

beforeAll(async () => {
  v1 = await authority.issue("v1");
  v2 = await authority.issue("v2", [
    "Inventory.reservation_safe",
    "Inventory.valid_request_succeeds",
  ]);
  v3 = await authority.issue("v3");
  bridge = await authority.issue(
    "bridge",
    ["Client.stock_conserved"],
    ["Inventory.reservation_safe"],
  );
  current = v1;
}, 300_000);
afterAll(() => server.stop(true));

test("live OPTIONS discovery authenticates resource/method and preserves normal requests", async () => {
  const httpv = createHTTPV({ backend: authority.backend });
  current = v1;
  const certificate = await httpv.query(url, local);
  expect(certificate).toEqual(advertise(v1));
  expect(
    (
      await httpv.verify(certificate.certificate, {
        allowedAxioms: inventoryAxioms,
      })
    ).status,
  ).toBe("verified");
  const response = await fetch(url, {
    method: "OPTIONS",
    headers: { Accept: `${MEDIA_TYPE}; q=1` },
  });
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("vary")).toBe("Accept");
  expect(
    (await fetch(url, { method: "POST" }).then((r) => r.json())).method,
  ).toBe("POST");
  expect(
    (await fetch(url, { method: "OPTIONS" }).then((r) => r.json())).method,
  ).toBe("OPTIONS");
  expect(
    (
      await fetch(url, {
        method: "OPTIONS",
        headers: { Accept: `${MEDIA_TYPE};q=0` },
      }).then((r) => r.json())
    ).method,
  ).toBe("OPTIONS");
  await expect(
    httpv.query(url, { ...local, method: "GET" }),
  ).rejects.toMatchObject({ reason: "missing-certificate" });
  await expect(
    httpv.query(url.replace("reservations", "other"), local),
  ).rejects.toBeInstanceOf(DiscoveryError);
  await expect(httpv.query(url, { method: "POST" })).rejects.toThrow("HTTPS");
  expect(methodName("patch")).toBe("patch");
  expect(methodName("PATCH")).toBe("PATCH");
  expect(methodName("connect")).toBe("connect");
});

test("compatible upgrade adds claims; changed definitions with identical names fail exact policy", async () => {
  const httpv = createHTTPV({ backend: authority.backend });
  const required = {
    format: "zklean/requirements/1" as const,
    specs: v1.specs,
  };
  for (const certificate of [v1, v2]) {
    current = certificate;
    const remote = await httpv.query(url, local);
    expect(
      (
        await httpv.checkCompatibility({
          operation: "Inventory.POST_reservations",
          advertisement: remote,
          requirements: required,
          allowedAxioms: inventoryAxioms,
          mode: "exact",
        })
      ).status,
    ).toBe("verified");
  }
  current = v3;
  const remote = await httpv.query(url, local);
  expect(
    (await httpv.verify(remote.certificate, { allowedAxioms: inventoryAxioms }))
      .status,
  ).toBe("verified");
  expect(
    await httpv.checkCompatibility({
      operation: "Inventory.POST_reservations",
      advertisement: remote,
      requirements: required,
      allowedAxioms: inventoryAxioms,
      mode: "exact",
    }),
  ).toMatchObject({ status: "incompatible", reason: "operation-mismatch" });
  expect(
    await httpv.checkCompatibility({
      operation: "Inventory.POST_reservations",
      advertisement: remote,
      requirements: required,
      allowedAxioms: inventoryAxioms,
    }),
  ).toMatchObject({ status: "unknown", reason: "operation-mismatch" });
});

test("a separately checked Lean bridge establishes the client requirement", async () => {
  const httpv = createHTTPV({ backend: authority.backend });
  const required = await requirements();
  expect(
    await httpv.checkCompatibility({
      operation: "Inventory.POST_reservations",
      advertisement: advertise(v1, "Inventory.POST_reservations"),
      requirements: required,
      allowedAxioms: inventoryAxioms,
    }),
  ).toMatchObject({ status: "unknown", reason: "missing-derivation" });
  expect(
    await httpv.checkCompatibility({
      operation: "Inventory.POST_reservations",
      advertisement: advertise(v1, "Inventory.POST_reservations"),
      requirements: required,
      derivation: bridge,
      allowedAxioms: inventoryAxioms,
    }),
  ).toMatchObject({ status: "verified", reason: "derivation" });
  expect(
    await httpv.checkCompatibility({
      operation: "Inventory.POST_reservations",
      advertisement: advertise(v1, "Inventory.POST_reservations"),
      requirements: required,
      derivation: bridge,
      allowedAxioms: inventoryAxioms,
      mode: "exact",
    }),
  ).toMatchObject({ status: "incompatible", reason: "requirements-not-met" });
  expect(
    await httpv.checkCompatibility({
      operation: "Inventory.POST_reservations",
      advertisement: advertise(v2, "Inventory.POST_reservations"),
      requirements: required,
      derivation: bridge,
      allowedAxioms: inventoryAxioms,
    }),
  ).toMatchObject({ status: "verified", reason: "derivation" });
  expect(
    await httpv.checkCompatibility({
      operation: "Inventory.POST_reservations",
      advertisement: advertise(v3, "Inventory.POST_reservations"),
      requirements: required,
      derivation: bridge,
      allowedAxioms: inventoryAxioms,
    }),
  ).toMatchObject({ status: "unknown", reason: "operation-mismatch" });
  expect(
    await httpv.checkCompatibility({
      operation: "Inventory.POST_reservations",
      advertisement: advertise(v1, "Inventory.POST_reservations"),
      requirements: required,
      derivation: v1,
      allowedAxioms: inventoryAxioms,
    }),
  ).toMatchObject({ status: "unknown", reason: "invalid-derivation" });
});

test("an independently proved requirement cannot hide conflicting shared definitions", async () => {
  const independent = await authority.issue("independent", [
    "Client.stock_conserved",
  ]);
  const httpv = createHTTPV({ backend: authority.backend });
  const required = await requirements();
  expect(
    await httpv.checkCompatibility({
      operation: "Inventory.POST_reservations",
      advertisement: advertise(v1, "Inventory.POST_reservations"),
      requirements: required,
      derivation: independent,
      allowedAxioms: inventoryAxioms,
    }),
  ).toMatchObject({ status: "verified", reason: "derivation" });
  const redefined = await authority.issue("changed-definition");
  expect(
    await httpv.checkCompatibility({
      operation: "Inventory.POST_reservations",
      advertisement: advertise(redefined, "Inventory.POST_reservations"),
      requirements: required,
      derivation: independent,
      allowedAxioms: inventoryAxioms,
    }),
  ).toMatchObject({ status: "unknown", reason: "operation-mismatch" });
});

test("operation bindings reject renamed remote operations and missing local policy", async () => {
  const independent = await authority.issue("independent", [
    "Client.stock_conserved",
  ]);
  const remote = await authority.issue(
    "renamed-operation",
    ["Backorders.reservation_safe"],
    [],
  );
  const httpv = createHTTPV({ backend: authority.backend });
  expect(
    await httpv.checkCompatibility({
      advertisement: advertise(remote, "Backorders.POST_reservations"),
      requirements: await requirements(),
      derivation: independent,
      operation: "Inventory.POST_reservations",
      allowedAxioms: inventoryAxioms,
    }),
  ).toMatchObject({ status: "unknown", reason: "operation-mismatch" });
  const input = {
    advertisement: advertise(v1),
    requirements: { format: "zklean/requirements/1" as const, specs: v1.specs },
    allowedAxioms: inventoryAxioms,
    operation: "Inventory.POST_reservations",
  };
  expect((await httpv.checkCompatibility(input)).status).toBe("verified");
  for (const operation of ["", "Missing.operation"])
    expect(
      await httpv.checkCompatibility({ ...input, operation }),
    ).toMatchObject({ status: "unknown", reason: "invalid-operation-binding" });
  expect(
    await httpv.checkCompatibility({
      ...input,
      operation: undefined,
    } as unknown as Parameters<typeof httpv.checkCompatibility>[0]),
  ).toMatchObject({ status: "unknown", reason: "invalid-operation-binding" });
  expect(
    await httpv.checkCompatibility({
      ...input,
      mode: "invalid",
    } as unknown as Parameters<typeof httpv.checkCompatibility>[0]),
  ).toMatchObject({ status: "unknown", reason: "invalid-options" });
});

test("an entrypoint change cannot reuse compatibility cached for the same certificate", async () => {
  const httpv = createHTTPV({ backend: authority.backend });
  const input = {
    advertisement: advertise(v1),
    operation: "Inventory.POST_reservations",
    requirements: { format: "zklean/requirements/1" as const, specs: v1.specs },
    allowedAxioms: inventoryAxioms,
    mode: "exact" as const,
  };
  expect((await httpv.checkCompatibility(input)).status).toBe("verified");
  expect(Object.hasOwn(readModel(v1.specs).declarations, "Nat.sub")).toBe(true);
  const rebound = advertise(v1, "Nat.sub");
  expect(
    await httpv.checkCompatibility({ ...input, advertisement: rebound }),
  ).toMatchObject({
    status: "incompatible",
    reason: "operation-mismatch",
    advertisedOperation: "Nat.sub",
  });
  const independent = await authority.issue("independent", [
    "Client.stock_conserved",
  ]);
  expect(
    await httpv.checkCompatibility({
      ...input,
      advertisement: rebound,
      requirements: await requirements(),
      derivation: independent,
      mode: "implication",
    }),
  ).toMatchObject({ status: "unknown", reason: "operation-mismatch" });
});

test("discovery requires a supported envelope and an explicit certified entrypoint", async () => {
  for (const body of [
    { certificates: { POST: v1 } },
    { format: "httpv/2", contracts: { POST: advertise(v1) } },
    { format: "httpv/1", contracts: { POST: v1 } },
    {
      format: "httpv/1",
      contracts: { POST: advertise(v1, "Missing.operation") },
    },
  ]) {
    const client = createHTTPV({
      fetch: async () =>
        Response.json(body, { headers: { "content-type": MEDIA_TYPE } }),
    });
    await expect(
      client.query("https://example.test/reservations", { method: "POST" }),
    ).rejects.toMatchObject({ reason: "invalid-advertisement" });
  }
});

test("server snapshots static advertisements while providers support atomic updates", async () => {
  const source = {
    operation: "Inventory.POST_reservations",
    certificate: structuredClone(v1),
  };
  const httpv = createHTTPV({ backend: authority.backend });
  const app = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    ...httpv.serve({
      routes: { "POST /reservations": source },
      fetch: () => new Response("ok"),
    }),
  });
  try {
    source.operation = "Nat.sub";
    source.certificate.specs = structuredClone(v3.specs);
    expect(
      await httpv.query(`http://127.0.0.1:${app.port}/reservations`, local),
    ).toEqual(advertise(v1));
  } finally {
    app.stop(true);
  }
});

test("cached verification enforces new axiom policies and detects statement tampering", async () => {
  const httpv = createHTTPV({ backend: authority.backend });
  const axioms = ["Trusted.evidence", "Trusted.stock_policy"];
  const certificate = await authority.issue(
    "axioms",
    ["Inventory.assumed_safe"],
    axioms,
  );
  const axiomPins = Object.fromEntries(
    axioms.map((name) => [
      name,
      declarationIdentity(readModel(certificate.specs), name),
    ]),
  );
  expect(
    (await httpv.verify(certificate, { allowedAxioms: axioms, axiomPins }))
      .status,
  ).toBe("verified");
  const calls = authority.calls;
  expect(
    (await httpv.verify(certificate, { allowedAxioms: axioms, axiomPins }))
      .status,
  ).toBe("verified");
  expect(authority.calls).toBe(calls);
  expect(
    (await httpv.verify(certificate, { allowedAxioms: inventoryAxioms }))
      .reason,
  ).toBe("forbidden-axiom");
  expect(
    (
      await httpv.verify(
        { ...certificate, axioms: [] },
        { allowedAxioms: inventoryAxioms },
      )
    ).reason,
  ).toBe("invalid-certificate");
  expect(
    (
      await createHTTPV().verify(certificate, {
        allowedAxioms: axioms,
        axiomPins,
      })
    ).reason,
  ).toBe("invalid-certificate");
  const model = readModel(v1.specs);
  delete model.declarations["Inventory.POST_reservations"];
  const unresolved = {
    ...v1,
    specs: { ...v1.specs, declarations: encodeBase64(canonical(model)) },
  };
  expect(
    (await httpv.verify(unresolved, { allowedAxioms: inventoryAxioms })).reason,
  ).toBe("invalid-certificate");
  const malformed = readModel(v1.specs);
  Object.assign(malformed.declarations["Inventory.reservation_safe"]!.thm!, {
    junk: true,
  });
  expect(
    (
      await httpv.verify(
        {
          ...v1,
          specs: {
            ...v1.specs,
            declarations: encodeBase64(canonical(malformed)),
          },
        },
        { allowedAxioms: inventoryAxioms },
      )
    ).reason,
  ).toBe("invalid-certificate");
});

test("a client snapshots its verifier trust profile", async () => {
  let rejectedCalls = 0;
  const options = { backend: authority.backend };
  const httpv = createHTTPV(options);
  expect(
    (await httpv.verify(v1, { allowedAxioms: inventoryAxioms })).status,
  ).toBe("verified");
  options.backend = {
    identity: "test:replacement",
    async verify() {
      rejectedCalls++;
      return false;
    },
  };
  expect(
    (await httpv.verify(v1, { allowedAxioms: inventoryAxioms })).status,
  ).toBe("verified");
  expect(rejectedCalls).toBe(0);
  expect(
    (await createHTTPV(options).verify(v1, { allowedAxioms: inventoryAxioms }))
      .reason,
  ).toBe("invalid-certificate");
  expect(rejectedCalls).toBe(1);
});

test("watch refreshes advertisements, emits transitions, contains callback failures, and stops", async () => {
  const httpv = createHTTPV({ backend: authority.backend });
  current = v1;
  const changes: VerificationResult[] = [];
  const errors: unknown[] = [];
  const monitor = httpv.watch({
    operation: "Inventory.POST_reservations",
    url,
    ...local,
    requirements: { format: "zklean/requirements/1", specs: v1.specs },
    allowedAxioms: inventoryAxioms,
    mode: "exact",
    interval: 60_000,
    onChange(result) {
      changes.push(result);
      if (changes.length === 1) throw new Error("application callback");
    },
    onError(error) {
      errors.push(error);
    },
  });
  try {
    expect((await monitor.refresh()).status).toBe("verified");
    await monitor.refresh();
    expect(changes).toHaveLength(1);
    current = v2;
    await monitor.refresh();
    current = v3;
    await Promise.all([monitor.refresh(), monitor.refresh()]);
    expect(changes.map((r) => r.status)).toEqual([
      "verified",
      "verified",
      "incompatible",
    ]);
    expect(errors).toHaveLength(1);
    monitor.stop();
    const count = discoveryCount;
    await monitor.refresh();
    expect(discoveryCount).toBe(count);
  } finally {
    monitor.stop();
  }
});

test("a synchronous change callback can request a coalesced refresh", async () => {
  const httpv = createHTTPV({ backend: authority.backend });
  current = v1;
  let changes = 0;
  let monitor!: Monitor;
  monitor = httpv.watch({
    operation: "Inventory.POST_reservations",
    url,
    ...local,
    requirements: { format: "zklean/requirements/1", specs: v1.specs },
    allowedAxioms: inventoryAxioms,
    mode: "exact",
    interval: 60_000,
    onChange() {
      changes++;
      void monitor.refresh();
    },
  });
  try {
    await Promise.race([
      monitor.refresh(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("refresh deadlocked")), 1000),
      ),
    ]);
    expect(changes).toBe(1);
  } finally {
    monitor.stop();
  }
});

test("periodic polling reports an unavailable dependency and honors external cancellation", async () => {
  const controller = new AbortController();
  let monitor: Monitor;
  let calls = 0;
  const statuses: string[] = [];
  const client = createHTTPV({
    backend: authority.backend,
    fetch: async () => {
      calls++;
      return calls === 1
        ? Response.json(
            { format: "httpv/1", contracts: { POST: advertise(v1) } },
            { headers: { "content-type": MEDIA_TYPE } },
          )
        : new Response("offline", { status: 503 });
    },
  });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      monitor.stop();
      reject(new Error("watch did not poll"));
    }, 2000);
    monitor = client.watch({
      operation: "Inventory.POST_reservations",
      url: "https://example.test/reservations",
      method: "POST",
      requirements: { format: "zklean/requirements/1", specs: v1.specs },
      allowedAxioms: inventoryAxioms,
      interval: 10,
      signal: controller.signal,
      onChange(result) {
        statuses.push(result.status);
        if (result.status === "unknown") {
          controller.abort();
          clearTimeout(timeout);
          resolve();
        }
      },
    });
  });
  expect(statuses).toEqual(["verified", "unknown"]);
  expect(calls).toBe(2);
});

test("discovery rejects redirects, malformed media, oversized and malformed certificates", async () => {
  const captured: RequestInit[] = [];
  const client = createHTTPV({
    maxResponseBytes: 30,
    fetch: async (_url, init) => {
      captured.push(init!);
      return new Response("x".repeat(31), {
        headers: { "content-type": MEDIA_TYPE },
      });
    },
  });
  await expect(
    client.query("https://example.test/reservations", { method: "POST" }),
  ).rejects.toMatchObject({ reason: "invalid-advertisement" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(captured[0]).toMatchObject({
    method: "OPTIONS",
    cache: "no-store",
    redirect: "error",
    headers: { Accept: MEDIA_TYPE, "Cache-Control": "no-cache" },
  });
  const bad = createHTTPV({
    fetch: async () =>
      Response.json({ format: "httpv/1", contracts: { POST: advertise(v1) } }),
  });
  await expect(
    bad.query("https://example.test/reservations", { method: "POST" }),
  ).rejects.toMatchObject({ reason: "missing-certificate" });
});

test("caller mutation during verification cannot substitute a different public model", async () => {
  const httpv = createHTTPV({ backend: authority.backend });
  const supplied = structuredClone(v3);
  const result = httpv.checkCompatibility({
    operation: "Inventory.POST_reservations",
    advertisement: advertise(supplied, "Inventory.POST_reservations"),
    requirements: { format: "zklean/requirements/1", specs: v1.specs },
    allowedAxioms: inventoryAxioms,
    mode: "exact",
  });
  supplied.specs = structuredClone(v1.specs);
  expect(await result).toMatchObject({ status: "incompatible" });
});

test("identical proposition syntax cannot hide a redefined operation", async () => {
  const redefined = await authority.issue("changed-definition");
  const originalType = readModel(v1.specs).declarations[
    "Inventory.reservation_safe"
  ]!.thm!.type;
  expect(
    readModel(redefined.specs).declarations["Inventory.reservation_safe"]!.thm!
      .type,
  ).toBe(originalType);
  const httpv = createHTTPV({ backend: authority.backend });
  expect(
    await httpv.checkCompatibility({
      operation: "Inventory.POST_reservations",
      advertisement: advertise(redefined, "Inventory.POST_reservations"),
      requirements: { format: "zklean/requirements/1", specs: v1.specs },
      allowedAxioms: inventoryAxioms,
      mode: "exact",
    }),
  ).toMatchObject({ status: "incompatible" });
  expect(
    await httpv.checkCompatibility({
      operation: "Inventory.POST_reservations",
      advertisement: advertise(redefined, "Inventory.POST_reservations"),
      requirements: await requirements(),
      derivation: bridge,
      allowedAxioms: inventoryAxioms,
    }),
  ).toMatchObject({ status: "unknown", reason: "operation-mismatch" });
});

test("file advertisements refresh in place and stale Lean requirement sidecars fail closed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "httpv-e2e-"));
  const path = join(directory, "certificate.json");
  const leanPath = join(directory, "remote.lean");
  const importedPath = join(directory, "Imported.lean");
  await Bun.write(path, JSON.stringify(v1));
  const httpv = createHTTPV({ backend: authority.backend });
  const fileServer = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    ...httpv.serve({
      routes: {
        "POST /reservations": {
          operation: "Inventory.POST_reservations",
          certificate: path,
        },
        "inspect /reservations": {
          operation: "Inventory.POST_reservations",
          certificate: path,
        },
      },
      fetch: () => new Response("ordinary"),
    }),
  });
  const target = `http://127.0.0.1:${fileServer.port}/reservations`;
  try {
    expect(await httpv.query(target, local)).toEqual(advertise(v1));
    expect(await httpv.query(target, { ...local, method: "inspect" })).toEqual(
      advertise(v1),
    );
    await expect(
      httpv.query(target, { ...local, method: "INSPECT" }),
    ).rejects.toMatchObject({ reason: "missing-certificate" });
    await Bun.write(path, JSON.stringify(v3));
    expect(await httpv.query(target, local)).toEqual(advertise(v3));
    const source = "import Imported\n-- local requirements snapshot\n";
    const imported = "-- imported requirement definitions\n";
    await Bun.write(leanPath, source);
    await Bun.write(importedPath, imported);
    await Bun.write(
      `${leanPath}.zklean.json`,
      JSON.stringify({
        format: "zklean/requirements/1",
        specs: v1.specs,
        sourceManifest: {
          format: "zklean/source-manifest/1",
          files: {
            "remote.lean": sha256(source),
            "Imported.lean": sha256(imported),
          },
        },
      }),
    );
    expect(
      (
        await httpv.checkCompatibility({
          operation: "Inventory.POST_reservations",
          advertisement: advertise(v1, "Inventory.POST_reservations"),
          requirements: leanPath,
          allowedAxioms: inventoryAxioms,
        })
      ).status,
    ).toBe("verified");
    await Bun.write(importedPath, `${imported}-- changed\n`);
    expect(
      (
        await httpv.checkCompatibility({
          operation: "Inventory.POST_reservations",
          advertisement: advertise(v1, "Inventory.POST_reservations"),
          requirements: leanPath,
          allowedAxioms: inventoryAxioms,
        })
      ).reason,
    ).toBe("requirements-unavailable");
  } finally {
    fileServer.stop(true);
    await rm(directory, { recursive: true });
  }
});
