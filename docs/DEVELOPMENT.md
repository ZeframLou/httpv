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

The published package depends on the npm `zklean@0.1.0` SDK instead, whose
embedded verifier means the tests and the example need only Bun.

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

These steps need the ZKLean CLI. An installed CLI includes everything it needs.
A CLI built from the `ZeframLou/zklean` source also needs the environment
variables that CI sets in `.github/workflows/check.yml` (`ZKLEAN_CLI`,
`ZKLEAN_NATIVE`, `ZKLEAN_EXPORTER`, `ZKLEAN_LAKE`).

```sh
bun run check:certificates  # every artifact matches its re-checked source
```

The repository is private, so the check verifies each committed export instead
of downloading the certificate's source URL.

`bun run prove` regenerates the requirements and each certificate, with the
Lean export it was proved from, which the certificate names as its source.
Review the diff before committing.

To prove with a source-built CLI, build it with proving enabled as ZKLean's
`docs/DEVELOPMENT.md` describes, including `--features prover,execute` and
`scripts/setup-circuits.sh`. Then prove with ZKLean's released **guest
program**, the program that checks Lean proofs inside the SP1 proving system,
so that the proofs verify under the key pinned in the SDK: set
`ZKLEAN_GUEST_ELF` to the guest and `ZKLEAN_PROFILE` to its **verifier
profile**, the JSON naming the guest's SHA-256 and verifying key. The prover
refuses to run if they disagree.

ZKLean has not measured proving for these modules; its smaller benchmark
workloads took 25 to 56 minutes and peaked near 12.5 GiB. Run one proof at a
time, with ZKLean's benchmark settings:

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

Publish the `zklean@0.1.0` SDK first, then HTTPV. In each repository:

```sh
bun run check
npm pack --dry-run
npm publish
```
