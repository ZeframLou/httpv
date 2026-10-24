# HTTPV compatibility profile

Certificates and formal model decoding use the
[ZKLean encoding profile](https://github.com/ZeframLou/zklean-dist/blob/main/docs/ENCODING.md).
HTTPV does not implement a second certificate decoder or verifier.

## Requirements and compatibility


Requirements are local JSON `{format:"zklean/requirements/1",specs}` snapshots.
A `.lean` path resolves to `<path>.zklean.json` and requires an
`zklean/source-manifest/1` containing the primary source, imported sources, Lake
project files, and toolchain artifacts. Every recorded digest is checked before
the snapshot is used. The self-contained snapshot is what the client trusts.

Discovery uses `{format:"httpv/1",contracts:{METHOD:{operation,certificate}}}`.
The envelope and each advertisement accept only these fields. `query` returns
an advertisement, retaining the server’s HTTPS-authenticated entrypoint. Its
nonempty operation name MUST occur in the certified claims’ public context.

The client MUST supply its expected `operation` name in its requirement claim
closure. It MUST equal the advertised entrypoint, and its entire resolved
context MUST match the authenticated remote claim closure. A proof-only
dependency or bridge-provided definition cannot supply an absent remote
operation. These bindings apply before exact matching, bridge evaluation, and
compatibility cache lookup. Cache keys include both entrypoints; changing the
advertised entrypoint invalidates acceptance even for an unchanged certificate.

Exact matching requires every requested claim to be certified and its complete
resolved public context to match. Binder display names and annotations are
ignored; constant names, types, and definition bodies are retained. Extra remote claims are permitted. Under
`mode:"exact"`, a mismatch is `incompatible` with that explicit exact contract.
The default implication mode returns `unknown` when no derivation is available.

A bridge certificate proves the required propositions, admitting certified remote
claims as axioms. Its actual axioms must be client-permitted axioms or verified
remote claims. The checker compares requirement contexts, the types of assumed
remote propositions, and every shared definition; reinterpreting a constant name
invalidates the bridge. Extra remote claims need not appear in a bridge. Operation names and contents
must remain stable; versioned or renamed operations require new reviewed local
requirements and bindings. Arbitrary operation correspondences are unsupported.
An implication is accepted only after independently verifying both certificates.

HTTPS authenticates the currently advertised resource/method association. The
library uses exact URL paths and requires explicit development opt-in for HTTP.
Formal authors must specify the operation, input domain, and resource association;
the transport cannot infer their meaning from a theorem's name.
