import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { unitInventoryFlow } from "../examples/unit-flow.ts";

test("real Groth16 inventory discovery, upgrades, request gating, and weaker bridge", async () => {
  const results = await unitInventoryFlow(
    fileURLToPath(
      new URL("../examples/unit-inventory/certificates/", import.meta.url),
    ),
  );
  expect(results.states.map((result) => result.status)).toEqual([
    "verified",
    "verified",
    "incompatible",
  ]);
  expect(results.derived).toMatchObject({
    status: "verified",
    reason: "derivation",
  });
  expect(results.rejected).toMatchObject({
    status: "unknown",
    reason: "invalid-certificate",
  });
  expect(results.rebound).toMatchObject({
    status: "incompatible",
    reason: "operation-mismatch",
    advertisedOperation: "UnitInventory.Stock.more",
  });
  expect(results.blocked).toEqual([
    "operation-mismatch",
    "operation-mismatch",
    "invalid-certificate",
  ]);
  expect(results.requests).toBe(2);
  expect(results.available).toBe(0);
  expect(results.receipts).toEqual([
    { reserved: 1, remaining: 1 },
    { reserved: 1, remaining: 0 },
  ]);
}, 60_000);
