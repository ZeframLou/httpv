import type { Certificate, Requirements } from "zklean";

type Identities = Readonly<Record<string, string>>;

/** Every wanted name is present with the same identity. Identities are closure
 * hashes that bind constant names, so equal ids mean equal meaning. */
export function includes(have: Identities, want: Identities): boolean {
  return Object.entries(want).every(
    ([name, id]) => Object.hasOwn(have, name) && have[name] === id,
  );
}

/** The advertised entrypoint is the expected one, and every definition the
 * requirements fix, the operation included, is certified unchanged. */
export function definitionsMatch(
  remote: Certificate,
  advertised: string,
  requirements: Requirements,
  operation: string,
): boolean {
  return (
    advertised === operation &&
    includes(remote.definitions, requirements.definitions)
  );
}

/** A bridge may assume the client's axioms and the remote's certified claims.
 * A name in both with different identities would be ambiguous, so it is refused. */
export function bridgePolicy(
  axioms: Identities,
  remote: Certificate,
): Identities | undefined {
  const shared = Object.keys(remote.claims).filter((name) =>
    Object.hasOwn(axioms, name),
  );
  if (shared.some((name) => axioms[name] !== remote.claims[name])) return;
  return { ...axioms, ...remote.claims };
}
