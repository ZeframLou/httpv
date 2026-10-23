# Test artifacts

The statement files are public formal models checked with Nanoda through ZKLean.
They cover a stock-conserving reservation operation, a compatible upgrade,
backorders, an independent client requirement, a Lean compatibility derivation,
redefined operations, and explicit axiom policies.

Regenerate them with `bun run fixtures` using the installed ZKLean CLI. The
transport tests sign these statements with a test-only Ed25519 authority;
production verification uses an application-configured cryptographic verifier.

`identity.certificate.json` is a real locally generated compressed SP1 STARK proof
from ZKLean's integration tests. `identity.verifier.json` is its trusted test key
and profile. Neither file defines the application's production trust policy.
The optional cryptographic integration test verifies this certificate through
ZKLean's native adapter.
