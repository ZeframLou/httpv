# Development

For application integration, see the [usage guide](USAGE.md).

## Set up

Install Bun 1.4.4 or newer, then run:

```sh
bun install --frozen-lockfile
bun run check
```

ZKLean's SDK embeds its verifier, so the tests and the example need only Bun.

## Current state

The example certificates in `examples/inventory/certificates` predate the
current certificate format and are waiting to be re-proved. Until they are:

- `bun run example` blocks all three versions with `unknown (unavailable)`;
- `tests/groth16.test.ts` is skipped;
- `bun run check:certificates` and CI's `formal-artifacts` job fail;
- the certificates' source exports (`*.ndjson`) are not committed yet.

## Repository layout

`examples/inventory/` holds the example's Lean project, requirements and
certificates, and `scripts/models.ts` lists each module's claims and output
path.

Most tests build certificates from made-up identities and sign them with a
test-only Ed25519 backend, so they run in milliseconds. `tests/groth16.test.ts`
uses the real certificates, whose proofs are Groth16 proofs, with the default
verifier.

## Regenerate artifacts

These steps need a checkout of the ZKLean release in `package.json`, built as
CI builds it in `.github/workflows/check.yml`, and `ZKLEAN_CLI` set to its
`src/cli.ts`. ZKLean finds its other tools from the checkout.

```sh
bun run check:certificates  # every artifact matches its re-checked source
```

The check verifies each committed export with `zklean fetch --from` instead of
downloading the certificate's source URL.

`bun run prove` regenerates the requirements and each certificate, with the
Lean export it was proved from, which the certificate names as its source.
Review the diff before committing.

Proving also needs ZKLean's prover build and the **guest program** attached to
that ZKLean GitHub release: the program that checks Lean proofs inside SP1, so
that the proofs verify under the key pinned in the SDK. ZKLean's
`CONTRIBUTING.md` describes both; set `ZKLEAN_GUEST_ELF` to that guest. The first proof downloads SP1's Groth16 circuit files. Proving takes
tens of minutes to hours and several GB of memory. Run one proof at a time and
bound its resources, for example:

```sh
RAYON_NUM_THREADS=2 GOMAXPROCS=2 GOMEMLIMIT=6GiB GOGC=20 \
ZKLEAN_PROVE_TIMEOUT=86400000 bun run prove
```

## Continuous integration

CI checks formatting, types and tests, and runs the example with no native
tools or Lean installed. A second job builds the pinned ZKLean CLI and runs
`bun run check:certificates`. While `ZeframLou/zklean` is private, set the
`ZKLEAN_READ_TOKEN` Actions secret to a read-only token with Contents access to
it.

## Release

Prove the example on the commit to be released, commit the certificates and
their exports, and tag it with the `version` in `package.json`, such as
`v0.1.0`. Each certificate names its export at that tag, so push the tag before
relying on `check:certificates` downloading sources.
