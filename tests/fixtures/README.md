# Test artifacts

The statement files are public formal models checked with Nanoda through ZKLean.
They cover a stock-conserving reservation operation, a compatible upgrade,
backorders, an independent client requirement, a Lean compatibility derivation,
redefined operations, and explicit axiom policies.

Regenerate them with `bun run fixtures` using the installed ZKLean CLI. The
transport tests sign these statements with a test-only Ed25519 authority;
production verification uses the SDK's pinned embedded verifier or an explicit
application-configured backend.

`identity.certificate.json` is a real locally generated SP1 5.2.4 Groth16 proof
from ZKLean's integration tests, accepted by native and WebAssembly verification.
`identity.verifier.json` records the checker identity and ELF digest. The
mandatory cryptographic integration test uses HTTPV's default embedded verifier
and rejects altered evidence and a different valid public model.

`independent.statement.json` is a separate Lean proof of the client's weaker
requirement. It admits no remote theorem as an axiom. Its regression demonstrates
why every shared definition must agree, including definitions outside assumed
remote-claim closures.
