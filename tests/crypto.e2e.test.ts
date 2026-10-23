import { expect, test } from "bun:test";
import { nativeBackend } from "zklean";
import { createHTTPV } from "../src/index.ts";

const binary = process.env.ZKLEAN_NATIVE;
test.skipIf(!binary)(
  "HTTPV verifies a real compressed STARK certificate through ZKLean",
  async () => {
    const certificate = await Bun.file(
      new URL("./fixtures/identity.certificate.json", import.meta.url),
    ).json();
    const profile = await Bun.file(
      new URL("./fixtures/identity.verifier.json", import.meta.url),
    ).json();
    const httpv = createHTTPV({
      backend: nativeBackend({
        binary: binary!,
        verifierKey: profile.verifierKey,
        verificationKey: profile.verificationKey,
      }),
    });
    expect(
      await httpv.verify(certificate, { allowedAxioms: [] }),
    ).toMatchObject({ status: "verified", reason: "valid" });
  },
  300_000,
);
