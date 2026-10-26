import { expect, test } from "bun:test";
import { createHTTPV, MEDIA_TYPE } from "../src/index.ts";
import type { Certificate, Requirement } from "../src/index.ts";
import { axioms, id, inventory } from "./helpers.ts";

const fixtures = inventory();
const httpv = createHTTPV({ backend: fixtures.backend });

const compare = (remote: Certificate, overrides: Partial<Requirement> = {}) =>
  httpv.compare(remote, {
    requirements: fixtures.exact,
    axioms,
    ...overrides,
  });

test("an upgrade that adds claims keeps an exact match", async () => {
  for (const remote of [fixtures.v1, fixtures.v2])
    expect(await compare(remote)).toMatchObject({
      status: "verified",
      reason: "exact-match",
      // What was certified, for noticing a new certificate.
      statementId: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
});

test("every required claim must be certified", async () => {
  expect(
    await compare(fixtures.v1, {
      requirements: { ...fixtures.exact, claims: fixtures.v2.claims },
    }),
  ).toMatchObject({ status: "incompatible", reason: "requirements-not-met" });
});

test("a redefined operation changes the claim's identity", async () => {
  expect(await compare(fixtures.v3)).toMatchObject({
    status: "incompatible",
    reason: "requirements-not-met",
  });
});

test("certificate failures are unknown", async () => {
  expect(await compare(fixtures.v1, { axioms: {} })).toMatchObject({
    status: "unknown",
    reason: "forbidden-axiom",
  });
  const forged = {
    ...fixtures.v1,
    claims: { "Inventory.reservation_safe": id("forged") },
  };
  expect(await compare(forged)).toMatchObject({
    status: "unknown",
    reason: "invalid-certificate",
  });
});

test("unusable requirements fail closed", async () => {
  for (const requirements of [
    "./missing.json",
    // Requiring nothing would accept every valid certificate.
    { ...fixtures.exact, claims: {} },
  ])
    expect(await compare(fixtures.v1, { requirements })).toMatchObject({
      status: "unknown",
      reason: "invalid-requirements",
    });
  // A caller's malformed axiom policy is its own error, not the certificate's.
  expect(
    await compare(fixtures.v1, { axioms: "propext" as never }),
  ).toMatchObject({ status: "unknown", reason: "invalid-requirements" });
});

test("mutating the inputs during verification cannot change what is compared", async () => {
  const supplied = structuredClone(fixtures.v3);
  const pending = httpv.compare(supplied, {
    requirements: fixtures.exact,
    axioms,
  });
  Object.assign(supplied, structuredClone(fixtures.v1));
  expect(await pending).toMatchObject({ status: "incompatible" });
});

test("a dependency changed during discovery is checked as it was", async () => {
  let open!: () => void;
  const discovery = new Promise<void>((resolve) => (open = resolve));
  const client = createHTTPV({
    backend: fixtures.backend,
    fetch: async () => {
      await discovery;
      return Response.json(
        { format: "httpv/1", certificates: { POST: fixtures.v3 } },
        { headers: { "content-type": MEDIA_TYPE } },
      );
    },
  });
  const dependency = {
    url: "https://inventory.example/reservations",
    method: "POST",
    requirements: fixtures.exact,
    axioms,
  };
  const pending = client.check(dependency);
  dependency.requirements = { ...fixtures.exact, claims: fixtures.v3.claims };
  open();
  expect(await pending).toMatchObject({ status: "incompatible" });
});

test("axiom policies are enforced by name and identity", async () => {
  expect(
    await compare(fixtures.v1, { axioms: { propext: id("another propext") } }),
  ).toMatchObject({ status: "unknown", reason: "axiom-mismatch" });
  // SPEC 4: these are never accepted, even when listed.
  expect(
    await compare(fixtures.v1, { axioms: { ...axioms, sorryAx: id("sorry") } }),
  ).toMatchObject({ status: "unknown", reason: "invalid-requirements" });
});

test("check() gives up on verification at its deadline", async () => {
  const client = createHTTPV({
    backend: { verify: () => new Promise(() => {}) },
    fetch: async () =>
      Response.json(
        { format: "httpv/1", certificates: { POST: fixtures.v1 } },
        { headers: { "content-type": MEDIA_TYPE } },
      ),
  });
  const dependency = {
    url: "https://inventory.example/reservations",
    method: "POST",
    requirements: fixtures.exact,
    axioms,
  };
  expect(await client.check(dependency, { timeout: 50 })).toMatchObject({
    status: "unknown",
    reason: "verifier-unavailable",
  });
  // An invalid timeout is reported, not thrown.
  expect(await client.check(dependency, { timeout: -1 })).toMatchObject({
    status: "unknown",
    reason: "unavailable",
  });
  // A dependency that cannot be copied is the caller's error.
  expect(
    await client.check({ ...dependency, requirements: (() => {}) as never }),
  ).toMatchObject({ status: "unknown", reason: "invalid-requirements" });
});
