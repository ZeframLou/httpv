import { expect, test } from "bun:test";
import { parseCertificate } from "zklean";
import { createHTTPV } from "../src/index.ts";
import type { Certificate } from "../src/index.ts";
import { advertise, listen } from "./helpers.ts";

const directory = new URL(
  "../examples/inventory/certificates/",
  import.meta.url,
);
const load = async (name: string) =>
  Bun.file(new URL(`${name}.json`, directory)).json();
const operation = "UnitInventory.POST_units";

// The example certificates predate identity certificates and are re-proved
// separately; until then this test cannot run.
const reproved = !Object.hasOwn(await load("v1"), "specs");

test.skipIf(!reproved)(
  "real Groth16 certificates: upgrades, bridge and tampering",
  async () => {
    const [v1, v2, v3, bridge] = await Promise.all(
      ["v1", "v2", "v3", "bridge"].map(async (name) =>
        parseCertificate(await load(name)),
      ),
    );
    const requirements = await load("requirements");
    let current = advertise(v1!, operation);
    using app = listen(() => current);
    const httpv = createHTTPV();
    const dependency = {
      url: app.url,
      method: "POST",
      allowInsecureHttp: true,
      operation,
      requirements: {
        format: "zklean/requirements/1" as const,
        claims: v1!.claims,
        definitions: v1!.definitions,
      },
      axioms: {},
    };
    const check = (certificate: Certificate) => {
      current = advertise(certificate, operation);
      return httpv.check(dependency);
    };

    expect(await check(v1!)).toMatchObject({ status: "verified" });
    expect(await check(v2!)).toMatchObject({ status: "verified" });
    expect(await check(v3!)).toMatchObject({
      status: "incompatible",
      reason: "operation-mismatch",
    });

    const tampered = structuredClone(v2!);
    const proof = Buffer.from(tampered.proof.slice(7), "base64");
    proof[40]! ^= 1;
    tampered.proof = `base64:${proof.toString("base64")}`;
    expect(await check(tampered)).toMatchObject({
      status: "unknown",
      reason: "invalid-certificate",
    });

    current = advertise(v2!, operation);
    expect(
      await httpv.check({ ...dependency, requirements, bridge: bridge! }),
    ).toMatchObject({ status: "verified", reason: "bridge" });
  },
  120_000,
);
