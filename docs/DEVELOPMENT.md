# Development

For application integration, see the [usage guide](USAGE.md).

## Set up

Install Bun 1.4.4 and give Git read access to the private `ZeframLou/zklean`
repository, then run:

```sh
bun install --frozen-lockfile
bun run check
bun run example
```

Development pins ZKLean to a Git commit; the published package depends on the
npm `zklean@0.1.0` SDK instead. HTTPV imports only the SDK's public exports, so
no Rust, SP1, or Lean toolchain is needed to run the tests or the example.

## Repository layout

| Path                    | Contents                                                     |
| ----------------------- | ------------------------------------------------------------ |
| `src/`                  | The library: protocol, server, client, compatibility rules.  |
| `examples/upgrades.ts`  | The runnable example.                                        |
| `examples/inventory/`   | Its Lean project and real Groth16 certificates.              |
| `tests/fixtures/lean/`  | Lean models for policy edge cases.                           |
| `tests/fixtures/`       | Checked public models of every Lean project.                 |
| `scripts/models.ts`     | Every model, with its claims, axioms, and output paths.      |

Most tests sign checked models with a test-only Ed25519 backend, so they run in
seconds. `tests/groth16.test.ts` uses the real certificates and the default
verifier.

## Regenerate artifacts

These steps need the [ZKLean CLI](https://github.com/ZeframLou/zklean); set
`ZKLEAN_CLI` if it is not on `PATH`.

```sh
bun run fixtures            # re-check every Lean model
bun run check:certificates  # each certificate proves its checked model
```

`bun run prove` regenerates the example certificates in place; review the diff
before committing. Each proof takes about two hours and peaks near 13 GiB of
memory on a four-CPU machine. To bound it:

```sh
RAYON_NUM_THREADS=4 GOMAXPROCS=2 GOMEMLIMIT=6GiB GOGC=20 \
ZKLEAN_PROVE_TIMEOUT=86400000 bun run prove
```

The axiom pins in each project's `axioms.json` fingerprint reviewed assumptions.
When the sources change, review and update them yourself; never accept pins
supplied by a certificate's producer.

## Continuous integration

Set the `ZKLEAN_READ_TOKEN` Actions secret to a read-only token with Contents
access to `ZeframLou/zklean`. CI checks formatting, types, and tests, and runs
the example from npm tarballs with native tools unavailable. A second job
builds the pinned CLI, re-checks every Lean model, fails on fixture drift, and
verifies the committed certificates.

## Check unpublished packages

Pack both packages, then run the example against the installed tarballs:

```sh
# In the ZKLean checkout:
npm pack --pack-destination dist
# In this checkout:
bun scripts/check-package.ts /path/to/zklean-0.1.0.tgz
```

To try them in another Bun application, install both tarballs:

```sh
npm install /path/to/zklean-0.1.0.tgz /path/to/httpv-0.1.0.tgz
```

## Publish to npm

Publish the `zklean@0.1.0` SDK first, then HTTPV. In each repository:

```sh
bun run check
npm pack --dry-run
npm publish
```
