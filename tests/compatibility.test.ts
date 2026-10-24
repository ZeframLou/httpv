import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { createHTTPV } from "../src/index.ts";
import type { Certificate, Requirement, Requirements } from "../src/index.ts";
import { advertise, axioms, id, inventory, operation } from "./helpers.ts";

const fixtures = inventory();
const httpv = createHTTPV({ backend: fixtures.authority.backend });

const compare = (
  remote: Certificate,
  overrides: Partial<Requirement> & { as?: string } = {},
) =>
  httpv.compare(advertise(remote, overrides.as), {
    operation,
    requirements: fixtures.exact,
    axioms,
    ...overrides,
  });

test("an upgrade that adds claims and definitions keeps an exact match", async () => {
  for (const remote of [fixtures.v1, fixtures.v2])
    expect(await compare(remote)).toMatchObject({
      status: "verified",
      reason: "exact-match",
    });
});

test("a redefined operation is incompatible, and no bridge can fix that", async () => {
  expect(await compare(fixtures.v3)).toMatchObject({
    status: "incompatible",
    reason: "operation-mismatch",
  });
  expect(
    await compare(fixtures.v3, {
      requirements: fixtures.client,
      bridge: fixtures.independent,
    }),
  ).toMatchObject({ status: "incompatible", reason: "operation-mismatch" });
});

test("the advertised entrypoint must be the expected operation", async () => {
  expect(await compare(fixtures.v2, { as: "Inventory.restock" })).toMatchObject(
    {
      status: "incompatible",
      reason: "operation-mismatch",
      advertisedOperation: "Inventory.restock",
    },
  );
  expect(
    await compare(fixtures.renamed, {
      as: "Backorders.POST_reservations",
      requirements: fixtures.client,
      bridge: fixtures.independent,
    }),
  ).toMatchObject({ status: "incompatible", reason: "operation-mismatch" });
  expect(
    await compare(fixtures.v1, { operation: "Missing.operation" }),
  ).toMatchObject({ status: "unknown", reason: "invalid-requirements" });
});

test("a verified bridge establishes a weaker requirement", async () => {
  expect(
    await compare(fixtures.v1, { requirements: fixtures.client }),
  ).toMatchObject({ status: "incompatible", reason: "requirements-not-met" });
  for (const [remote, bridge] of [
    [fixtures.v1, fixtures.bridge],
    [fixtures.v2, fixtures.bridge],
    [fixtures.v1, fixtures.independent],
  ])
    expect(
      await compare(remote!, {
        requirements: fixtures.client,
        bridge: bridge!,
      }),
    ).toMatchObject({ status: "verified", reason: "bridge" });
});

test("a bridge fails if it proves something else or assumes more than it may", async () => {
  const invalid = { status: "unknown", reason: "invalid-bridge" };
  // Proves the wrong claims.
  expect(
    await compare(fixtures.v1, {
      requirements: fixtures.client,
      bridge: fixtures.v1,
    }),
  ).toMatchObject(invalid);
  // Assumes a remote claim that the remote weakened under the same name.
  expect(
    await compare(fixtures.weakened, {
      requirements: fixtures.client,
      bridge: fixtures.bridge,
    }),
  ).toMatchObject(invalid);
  // A client axiom and a remote claim with one name but different meanings.
  expect(
    await compare(fixtures.v1, {
      requirements: fixtures.client,
      bridge: fixtures.bridge,
      axioms: { ...axioms, "Inventory.reservation_safe": id("other") },
    }),
  ).toMatchObject({ ...invalid, detail: expect.stringContaining("share") });
});

test("certificate failures are unknown", async () => {
  expect(await compare(fixtures.v1, { axioms: {} })).toMatchObject({
    status: "unknown",
    reason: "forbidden-axiom",
  });
  expect(
    await compare(fixtures.v1, { axioms: { propext: id("not propext") } }),
  ).toMatchObject({ status: "unknown", reason: "axiom-mismatch" });
  const tampered = {
    ...fixtures.v1,
    claims: { "Inventory.reservation_safe": id("forged") },
  };
  expect(await compare(tampered)).toMatchObject({
    status: "unknown",
    reason: "invalid-certificate",
  });
});

test("unusable requirements fail closed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "httpv-"));
  const path = join(directory, "requirements.json");
  try {
    await Bun.write(path, JSON.stringify(fixtures.exact));
    expect((await compare(fixtures.v1, { requirements: path })).status).toBe(
      "verified",
    );
    for (const requirements of [
      join(directory, "missing.json"),
      { ...fixtures.exact, extra: true },
    ])
      expect(
        await compare(fixtures.v1, {
          requirements: requirements as Requirements,
        }),
      ).toMatchObject({ status: "unknown", reason: "invalid-requirements" });
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("mutating the inputs during verification cannot change what is compared", async () => {
  const supplied = advertise(structuredClone(fixtures.v3));
  const pending = httpv.compare(supplied, {
    operation,
    requirements: fixtures.exact,
    axioms,
  });
  Object.assign(supplied.certificate, structuredClone(fixtures.v1));
  expect(await pending).toMatchObject({ status: "incompatible" });
});
