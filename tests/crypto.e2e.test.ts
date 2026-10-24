import { expect, test } from "bun:test";
import { createHTTPV } from "../src/index.ts";

test("default HTTPV verifies a real Groth16 certificate through ZKLean", async () => {
  const certificate = await Bun.file(
    new URL("./fixtures/identity.certificate.json", import.meta.url),
  ).json();
  const httpv = createHTTPV();
  expect(await httpv.verify(certificate, { allowedAxioms: [] })).toMatchObject({
    status: "verified",
    reason: "valid",
  });
  const evidence = Buffer.from(certificate.proof.slice(7), "base64");
  evidence[40] = evidence[40]! ^ 1;
  expect(
    await httpv.verify(
      { ...certificate, proof: `base64:${evidence.toString("base64")}` },
      {
        allowedAxioms: [],
      },
    ),
  ).toMatchObject({ status: "unknown", reason: "invalid-certificate" });
  const different = await Bun.file(
    new URL("./fixtures/v1.statement.json", import.meta.url),
  ).json();
  expect(
    await httpv.verify(
      { ...different, proof: certificate.proof },
      {
        allowedAxioms: ["propext"],
      },
    ),
  ).toMatchObject({ status: "unknown", reason: "invalid-certificate" });
}, 300_000);
