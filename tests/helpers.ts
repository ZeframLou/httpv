import { generateKeyPairSync, sign, verify } from "node:crypto";
import {
  canonical,
  encodeBase64,
  parseCertificate,
  statement,
} from "zklean/encoding";
import type { Certificate, ProofBackend, Requirements } from "zklean";
import { inventoryAxioms } from "../examples/inventory.ts";

export { inventoryAxioms };

/** Transport and policy tests sign frozen statements previously checked by Nanoda.
 * This test-only backend never substitutes for the SP1 verifier in production. */
export function testAuthority() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  let calls = 0;
  const backend: ProofBackend = {
    identity: `test:${publicKey.export({ type: "spki", format: "der" }).toString("hex")}`,
    async verify(certificate) {
      calls++;
      return verify(
        null,
        Buffer.from(canonical(statement(certificate))),
        publicKey,
        Buffer.from(certificate.proof.slice(7), "base64"),
      );
    },
  };
  return {
    backend,
    get calls() {
      return calls;
    },
    async issue(
      module: string,
      claims?: string[],
      allowedAxioms = inventoryAxioms,
    ): Promise<Certificate> {
      const value = await Bun.file(
        new URL(`./fixtures/${module}.statement.json`, import.meta.url),
      ).json();
      const certificate = parseCertificate({ ...value, proof: "base64:AA==" });
      if (
        claims &&
        canonical([...claims].sort()) !== canonical(certificate.specs.claims)
      )
        throw new Error("fixture claims differ from the requested claims");
      if (certificate.axioms.some((axiom) => !allowedAxioms.includes(axiom)))
        throw new Error("fixture requires an unpermitted axiom");
      return {
        ...certificate,
        proof: encodeBase64(
          sign(null, Buffer.from(canonical(value)), privateKey),
        ),
      };
    },
  };
}

export async function requirements(): Promise<Requirements> {
  return Bun.file(
    new URL("./fixtures/requirements.json", import.meta.url),
  ).json();
}
