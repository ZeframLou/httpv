import { createHash, generateKeyPairSync, sign, verify } from "node:crypto";
import type { Certificate, ProofBackend, Requirements } from "zklean";
import {
  canonical,
  decodeBase64,
  encodeBase64,
  statement,
} from "zklean/encoding";
// standardAxioms comes through httpv, as the README imports it.
import { serve, standardAxioms } from "../src/index.ts";
import type { Source } from "../src/index.ts";

/** A stand-in identity: in real certificates these are Lean closure hashes. */
export const id = (label: string) =>
  createHash("sha256").update(label).digest("hex");

export const axioms = { propext: standardAxioms.propext! };

/** The inventory story as claim identities. Each identity covers the claim's
 * statement and the operation it is about, so V3, which redefines the
 * operation to accept backorders, certifies a different identity. The
 * certificates are signed by a test-only Ed25519 backend, so tests run without
 * SP1; production uses ZKLean's pinned Groth16 verifier. */
export function inventory() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const signed = (c: Certificate) => Buffer.from(canonical(statement(c)));
  const backend: ProofBackend = {
    identity: `test:${publicKey.export({ type: "spki", format: "der" }).toString("hex")}`,
    async verify(certificate) {
      // The 64-byte signature leads the proof's fixed 260 bytes.
      return verify(
        null,
        signed(certificate),
        publicKey,
        decodeBase64(certificate.proof).subarray(0, 64),
      );
    },
  };
  const issue = (
    claims: Record<string, string>,
    used: Record<string, string> = {},
  ): Certificate => {
    const unsigned = {
      format: "zklean/1" as const,
      claims,
      axioms: used,
      source: "https://example.test/inventory.ndjson",
      proof: "",
    };
    return {
      ...unsigned,
      proof: encodeBase64(
        Buffer.concat([
          sign(null, signed(unsigned), privateKey),
          Buffer.alloc(260 - 64),
        ]),
      ),
    };
  };
  const safe = { "Inventory.reservation_safe": id("reservation_safe v1") };
  return {
    backend,
    v1: issue(safe, axioms),
    v2: issue(
      {
        ...safe,
        "Inventory.valid_request_succeeds": id("valid_request_succeeds"),
      },
      axioms,
    ),
    v3: issue({
      "Inventory.reservation_safe": id("reservation_safe backorders"),
    }),
    /** What a client requiring V1's guarantee stores. */
    exact: { format: "zklean/requirements/1", claims: safe } as Requirements,
  };
}

/** Serve one route on a random local port. */
export function listen(source: Source) {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    ...serve({
      routes: { "POST /reservations": source },
      fetch: (request) => Response.json({ method: request.method }),
    }),
  });
  return {
    url: `http://127.0.0.1:${server.port}/reservations`,
    [Symbol.dispose]: () => server.stop(true),
  };
}
