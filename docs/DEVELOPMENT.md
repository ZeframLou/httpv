# Development

For application integration, see the [usage guide](USAGE.md).

## Set up

Install Bun 1.4.4 or newer. The development dependency on ZKLean is fetched
from the private `ZeframLou/zklean` repository with the URL
`https://git@github.com/…`; if you use SSH, map it first:

```sh
git config --global url."git@github.com:".insteadOf https://git@github.com/
```

Then run:

```sh
bun install --frozen-lockfile
bun run check
```

ZKLean's SDK embeds its verifier, so the tests and the example need only Bun.
The published package peer-depends on the npm `zklean@0.1.0` SDK instead of
the Git dependency.

## Current state

The example certificates in `examples/inventory/certificates` predate the
current certificate format and are waiting to be re-proved. Until they are:

- `bun run example` blocks all three versions with `unknown (unavailable)`;
- `tests/groth16.test.ts` is skipped;
- `bun run check:certificates`, `bun scripts/check-package.ts`, and both CI
  jobs fail (`e2e` at its npm-package step);
- the certificates' source exports (`*.ndjson`) are not committed yet.

## Repository layout

| Path                   | Contents                                                           |
| ---------------------- | ------------------------------------------------------------------ |
| `src/`                 | The library: protocol, server, and client with its check.         |
| `examples/upgrades.ts` | The runnable example.                                              |
| `examples/inventory/`  | Its Lean project, requirements, and certificates (see above).     |
| `scripts/models.ts`    | Each module's claims and output path.                              |

Most tests build certificates from made-up identities and sign them with a
test-only Ed25519 backend, so they run in milliseconds. `tests/groth16.test.ts`
uses the real certificates, whose proofs are Groth16 proofs, with the default
verifier.

## Regenerate artifacts

These steps need a `ZeframLou/zklean` checkout at the pinned commit, built as
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

Proving also needs ZKLean's prover build, the SP1 circuits, and the **guest
program** that ZKLean's CI uploads as the `zklean-guest-elf` artifact: the
program that checks Lean proofs inside SP1, so that the proofs verify under the
key pinned in the SDK. ZKLean's `CONTRIBUTING.md` describes all three; set
`ZKLEAN_GUEST_ELF` to that guest. Proving takes tens
of minutes to hours and several GB of memory. Run one proof at a time and bound
its resources, for example:

```sh
RAYON_NUM_THREADS=2 GOMAXPROCS=2 GOMEMLIMIT=6GiB GOGC=20 \
TRACE_GEN_WORKERS=1 CHECKPOINTS_CHANNEL_CAPACITY=1 \
RECORDS_AND_TRACES_CHANNEL_CAPACITY=1 ZKLEAN_PROVE_TIMEOUT=86400000 \
bun run prove
```

## Continuous integration

Set the `ZKLEAN_READ_TOKEN` Actions secret to a read-only token with Contents
access to `ZeframLou/zklean`. CI checks formatting, types, and tests, and runs
the example from npm tarballs with native tools unavailable. A second job
builds the pinned CLI and runs `bun run check:certificates`.

## Check unpublished packages

Pack the ZKLean SDK from `node_modules`, then run the example against both
installed tarballs:

```sh
mkdir -p dist
npm pack ./node_modules/zklean --pack-destination dist
bun scripts/check-package.ts dist/zklean-0.1.0.tgz
```

To try them in another Bun application, pack HTTPV as well and install both
tarballs there:

```sh
npm pack --pack-destination dist
npm install /path/to/httpv/dist/zklean-0.1.0.tgz /path/to/httpv/dist/httpv-0.1.0.tgz
```

## Publish to npm

Publish the `zklean@0.1.0` SDK first, after the checks in ZKLean's
`CONTRIBUTING.md`, then HTTPV:

```sh
bun run check
npm pack --dry-run
npm publish
```
