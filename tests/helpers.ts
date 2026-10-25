import { createHash, generateKeyPairSync, sign, verify } from "node:crypto";
import { canonical, encodeBase64 } from "zklean/encoding";
import { standardAxioms } from "zklean";
import type { Certificate, ProofBackend, Requirements } from "zklean";
import { serve } from "../src/index.ts";
import type { Advertisement, Source } from "../src/index.ts";

/** A stand-in identity: in real certificates these are Lean closure hashes. */
export const id = (label: string) =>
  createHash("sha256").update(label).digest("hex");

export const operation = "Inventory.POST_reservations";
export const axioms = { propext: standardAxioms.propext! };

const statement = ({ format, claims, axioms }: Certificate) =>
  canonical({ format, claims, axioms });

/** Signs statements, so policy tests run without SP1. Production uses
 * ZKLean's pinned Groth16 verifier. */
export function testAuthority() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const backend: ProofBackend = {
    identity: `test:${publicKey.export({ type: "spki", format: "der" }).toString("hex")}`,
    async verify(certificate) {
      return verify(
        null,
        Buffer.from(statement(certificate)),
        publicKey,
        Buffer.from(certificate.proof.slice(7), "base64"),
      );
    },
  };
  const issue = (
    claims: Record<string, string>,
    axioms: Record<string, string> = {},
  ): Certificate => {
    const unsigned = {
      format: "zklean/1" as const,
      claims,
      axioms,
      source: "https://example.test/inventory.ndjson",
      proof: "",
    };
    return {
      ...unsigned,
      proof: encodeBase64(
        sign(null, Buffer.from(statement(unsigned)), privateKey),
      ),
    };
  };
  return { backend, issue };
}

export function requirements(claims: Record<string, string>): Requirements {
  return { format: "zklean/requirements/1", claims };
}

/** The inventory story as claim identities. Each identity covers the claim's
 * statement and the operation it is about, so V3, which redefines the
 * operation to accept backorders, certifies a different identity. */
export function inventory(authority = testAuthority()) {
  const safe = { "Inventory.reservation_safe": id("reservation_safe v1") };
  return {
    authority,
    v1: authority.issue(safe, axioms),
    v2: authority.issue(
      {
        ...safe,
        "Inventory.valid_request_succeeds": id("valid_request_succeeds"),
      },
      axioms,
    ),
    v3: authority.issue({
      "Inventory.reservation_safe": id("reservation_safe backorders"),
    }),
    /** What a client requiring V1's guarantee stores. */
    exact: requirements(safe),
  };
}

export function advertise(
  certificate: Certificate,
  name = operation,
): Advertisement {
  return { operation: name, certificate };
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
