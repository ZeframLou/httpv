import { expect, test } from "bun:test";
import { parseCertificate } from "zklean";
import { createHTTPV } from "../src/index.ts";
import type { Certificate } from "../src/index.ts";
import { listen } from "./helpers.ts";

const directory = new URL(
  "../examples/inventory/certificates/",
  import.meta.url,
);
const load = async (name: string) =>
  Bun.file(new URL(`${name}.json`, directory)).json();

// The example certificates are re-proved separately for the current format;
// until then this test cannot run.
const current = await load("v1");
const reproved =
  Object.hasOwn(current, "source") && !Object.hasOwn(current, "definitions");

test.skipIf(!reproved)(
  "real Groth16 certificates: upgrades and tampering",
  async () => {
    const [v1, v2, v3] = await Promise.all(
      ["v1", "v2", "v3"].map(async (name) =>
        parseCertificate(await load(name)),
      ),
    );
    let served = v1!;
    using app = listen(() => served);
    const httpv = createHTTPV();
    // Stated as an axiom in Requirements.lean; it matches V1's theorem.
    const dependency = {
      url: app.url,
      method: "POST",
      allowInsecureHttp: true,
      requirements: await load("requirements"),
      axioms: {},
    };
    const check = (certificate: Certificate) => {
      served = certificate;
      return httpv.check(dependency);
    };

    expect(await check(v1!)).toMatchObject({ status: "verified" });
    expect(await check(v2!)).toMatchObject({ status: "verified" });
    expect(await check(v3!)).toMatchObject({
      status: "incompatible",
      reason: "requirements-not-met",
    });

    const tampered = structuredClone(v2!);
    const proof = Buffer.from(tampered.proof.slice(7), "base64");
    proof[40]! ^= 1;
    tampered.proof = `base64:${proof.toString("base64")}`;
    expect(await check(tampered)).toMatchObject({
      status: "unknown",
      reason: "invalid-certificate",
    });
  },
  120_000,
);
