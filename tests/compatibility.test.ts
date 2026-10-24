import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, expect, test } from "bun:test";
import { sha256 } from "zklean/encoding";
import { createHTTPV } from "../src/index.ts";
import { bridgeMatches } from "../src/compatibility.ts";
import type { Certificate, Requirements } from "../src/index.ts";
import {
  advertise,
  inventoryAxioms,
  operation,
  requirements,
  snapshot,
  testAuthority,
} from "./helpers.ts";

const authority = testAuthority();
const httpv = createHTTPV({ backend: authority.backend });
const fixtures: Record<string, Certificate> = {};
let required: Requirements;

beforeAll(async () => {
  for (const name of [
    "v1",
    "v2",
    "v3",
    "bridge",
    "independent",
    "changed-definition",
    "renamed-operation",
    "weakened-claim",
  ])
    fixtures[name] = await authority.issue(name);
  required = await requirements();
});

const compare = (
  remote: string,
  overrides: Partial<Parameters<typeof httpv.compare>[1]> & {
    as?: string;
  } = {},
) =>
  httpv.compare(advertise(fixtures[remote]!, overrides.as), {
    operation,
    requirements: snapshot(fixtures.v1!),
    allowedAxioms: inventoryAxioms,
    ...overrides,
  });

test("an upgrade that adds claims keeps an exact match", async () => {
  for (const remote of ["v1", "v2"])
    expect(await compare(remote)).toMatchObject({
      status: "verified",
      reason: "exact-match",
    });
});

test("a redefined operation is incompatible even with an identical theorem name", async () => {
  for (const remote of ["v3", "changed-definition"]) {
    expect(await compare(remote)).toMatchObject({
      status: "incompatible",
      reason: "operation-mismatch",
    });
    expect(
      await compare(remote, {
        requirements: required,
        bridge: fixtures.bridge!,
      }),
    ).toMatchObject({ status: "incompatible", reason: "operation-mismatch" });
  }
});

test("the advertised entrypoint must be the expected operation", async () => {
  expect(await compare("v1", { as: "Nat.sub" })).toMatchObject({
    status: "incompatible",
    reason: "operation-mismatch",
    advertisedOperation: "Nat.sub",
  });
  expect(
    await compare("renamed-operation", {
      as: "Backorders.POST_reservations",
      requirements: required,
      bridge: fixtures.independent!,
    }),
  ).toMatchObject({ status: "incompatible", reason: "operation-mismatch" });
  for (const name of ["", "Missing.operation"])
    expect(
      await compare("v1", { as: name || operation, operation: name }),
    ).toMatchObject({ status: "unknown", reason: "invalid-requirements" });
});

test("a verified bridge establishes a weaker requirement", async () => {
  expect(await compare("v1", { requirements: required })).toMatchObject({
    status: "incompatible",
    reason: "requirements-not-met",
  });
  for (const [remote, bridge] of [
    ["v1", "bridge"],
    ["v2", "bridge"],
    ["v1", "independent"],
  ])
    expect(
      await compare(remote!, {
        requirements: required,
        bridge: fixtures[bridge!]!,
      }),
    ).toMatchObject({ status: "verified", reason: "bridge" });
  expect(
    await compare("v1", { requirements: required, bridge: fixtures.v1! }),
  ).toMatchObject({ status: "unknown", reason: "invalid-bridge" });
});

test("certificate failures are unknown", async () => {
  expect(await compare("v1", { allowedAxioms: [] })).toMatchObject({
    status: "unknown",
    reason: "forbidden-axiom",
  });
  const tampered = { ...fixtures.v1!, specs: fixtures.v3!.specs };
  expect(
    await httpv.compare(advertise(tampered), {
      operation,
      requirements: snapshot(fixtures.v1!),
      allowedAxioms: inventoryAxioms,
    }),
  ).toMatchObject({ status: "unknown", reason: "invalid-certificate" });
});

test("a stale Lean requirements sidecar fails closed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "httpv-"));
  const lean = join(directory, "Requirements.lean");
  const imported = join(directory, "Imported.lean");
  try {
    await Bun.write(lean, "import Imported\n");
    await Bun.write(imported, "-- definitions\n");
    await Bun.write(
      `${lean}.zklean.json`,
      JSON.stringify({
        ...snapshot(fixtures.v1!),
        sourceManifest: {
          format: "zklean/source-manifest/1",
          files: {
            "Requirements.lean": sha256("import Imported\n"),
            "Imported.lean": sha256("-- definitions\n"),
          },
        },
      }),
    );
    expect((await compare("v1", { requirements: lean })).status).toBe(
      "verified",
    );
    await Bun.write(imported, "-- changed\n");
    expect(await compare("v1", { requirements: lean })).toMatchObject({
      status: "unknown",
      reason: "invalid-requirements",
    });
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("mutating the inputs during verification cannot change what is compared", async () => {
  const supplied = advertise(structuredClone(fixtures.v3!));
  const pending = httpv.compare(supplied, {
    operation,
    requirements: snapshot(fixtures.v1!),
    allowedAxioms: inventoryAxioms,
  });
  (supplied.certificate as { specs: unknown }).specs = fixtures.v1!.specs;
  expect(await pending).toMatchObject({ status: "incompatible" });
});

test("a bridge cannot share a name with a different remote definition", () => {
  expect(
    bridgeMatches(fixtures.v1!, required.specs, fixtures.independent!),
  ).toBe(true);
  expect(
    bridgeMatches(
      fixtures["changed-definition"]!,
      required.specs,
      fixtures.independent!,
    ),
  ).toBe(false);
});

test("a bridge stops holding when the remote claim it assumes is weakened", async () => {
  expect(
    await compare("weakened-claim", {
      requirements: required,
      bridge: fixtures.bridge!,
    }),
  ).toMatchObject({ status: "unknown", reason: "invalid-bridge" });
});
