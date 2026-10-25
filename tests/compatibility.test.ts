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

test("an upgrade that adds claims keeps an exact match", async () => {
  for (const remote of [fixtures.v1, fixtures.v2])
    expect(await compare(remote)).toMatchObject({
      status: "verified",
      reason: "exact-match",
    });
});

test("a redefined operation changes the claim's identity", async () => {
  expect(await compare(fixtures.v3)).toMatchObject({
    status: "incompatible",
    reason: "requirements-not-met",
  });
});

test("the advertised operation must be the expected one", async () => {
  // A certificate shared across endpoints still has to name this endpoint.
  expect(
    await compare(fixtures.v2, { as: "Inventory.DELETE_reservations" }),
  ).toMatchObject({
    status: "incompatible",
    reason: "operation-mismatch",
    advertisedOperation: "Inventory.DELETE_reservations",
  });
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
