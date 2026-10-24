import { createHash, generateKeyPairSync, sign, verify } from "node:crypto";
import { canonical, encodeBase64 } from "zklean/encoding";
import type { Certificate, ProofBackend, Requirements } from "zklean";
import { serve } from "../src/index.ts";
import type { Advertisement, Source } from "../src/index.ts";

/** A stand-in identity: in real certificates these are Lean closure hashes. */
export const id = (label: string) =>
  createHash("sha256").update(label).digest("hex");

export const operation = "Inventory.POST_reservations";
export const axioms = { propext: id("propext") };

type Statement = Omit<Certificate, "format" | "proof">;
const statement = ({ format, claims, definitions, axioms }: Certificate) =>
  canonical({ format, claims, definitions, axioms });

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
  const issue = ({
    claims,
    definitions = {},
    axioms = {},
  }: Partial<Statement> & Pick<Statement, "claims">): Certificate => {
    const unsigned = {
      format: "zklean/1" as const,
      claims,
      definitions,
      axioms,
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

export function requirements(
  claims: Record<string, string>,
  definitions: Record<string, string>,
): Requirements {
  return { format: "zklean/requirements/1", claims, definitions };
}

/** The inventory story as identities. V3 redefines the operation to accept
 * backorders; the weakened version keeps the operation but promises less. */
export function inventory(authority = testAuthority()) {
  const op = { [operation]: id("POST_reservations v1") };
  const safe = { "Inventory.reservation_safe": id("reservation_safe") };
  const conserved = { "Client.stock_conserved": id("stock_conserved") };
  return {
    authority,
    v1: authority.issue({ claims: safe, definitions: op, axioms }),
    v2: authority.issue({
      claims: {
        ...safe,
        "Inventory.valid_request_succeeds": id("valid_request_succeeds"),
      },
      definitions: {
        ...op,
        "Inventory.restock": id("restock"),
        "Inventory.audit": id("audit"),
      },
      axioms,
    }),
    v3: authority.issue({
      claims: { "Inventory.reservation_safe": id("reservation_safe v3") },
      definitions: { [operation]: id("POST_reservations backorders") },
    }),
    weakened: authority.issue({
      claims: { "Inventory.reservation_safe": id("reservation_safe weak") },
      definitions: op,
      axioms,
    }),
    renamed: authority.issue({
      claims: { "Backorders.reservation_safe": id("reservation_safe") },
      definitions: {
        "Backorders.POST_reservations": id("POST_reservations v1"),
      },
    }),
    /** Proves the client's requirement from the remote safety claim. */
    bridge: authority.issue({ claims: conserved, axioms: safe }),
    /** Proves it from the operation's definition alone. */
    independent: authority.issue({ claims: conserved, axioms }),
    /** What a client requiring exactly V1's guarantee stores. */
    exact: requirements(safe, op),
    /** What the checkout client's own proof assumes. */
    client: requirements(conserved, op),
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
