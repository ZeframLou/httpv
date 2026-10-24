import { generateKeyPairSync, sign, verify } from "node:crypto";
import {
  canonical,
  encodeBase64,
  parseCertificate,
  statement,
} from "zklean/encoding";
import type { Certificate, ProofBackend, Requirements } from "zklean";
import { serve } from "../src/index.ts";
import type { Advertisement, Source } from "../src/index.ts";

/** Lean's arithmetic lemmas use propositional extensionality. */
export const inventoryAxioms = ["propext"];
export const operation = "Inventory.POST_reservations";

export function advertise(
  certificate: Certificate,
  name = operation,
): Advertisement {
  return { operation: name, certificate };
}

/** Signs frozen statements already checked by the Lean kernel, so policy tests
 * run without SP1. Production uses ZKLean's pinned Groth16 verifier. */
export function testAuthority() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const backend: ProofBackend = {
    identity: `test:${publicKey.export({ type: "spki", format: "der" }).toString("hex")}`,
    async verify(certificate) {
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
    async issue(fixture: string): Promise<Certificate> {
      const value = await Bun.file(
        new URL(`./fixtures/${fixture}.statement.json`, import.meta.url),
      ).json();
      return {
        ...parseCertificate({ ...value, proof: "base64:AA==" }),
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

export function snapshot(certificate: Certificate): Requirements {
  return { format: "zklean/requirements/1", specs: certificate.specs };
}

/** Serve one route on a random local port. */
export function listen(
  source: Source,
  fetch = (request: Request) => Response.json({ method: request.method }),
) {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    ...serve({ routes: { "POST /reservations": source }, fetch }),
  });
  return {
    url: `http://127.0.0.1:${server.port}/reservations`,
    [Symbol.dispose]: () => server.stop(true),
  };
}
