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
| `examples/inventory/`   | Its Lean project, requirements and real Groth16 certificates. |
| `scripts/models.ts`     | Each module's claims and output path.                        |

Most tests build certificates from made-up identities and sign them with a
test-only Ed25519 backend, so they run in milliseconds. `tests/groth16.test.ts`
uses the real certificates and the default verifier.

## Regenerate artifacts

These steps need the [ZKLean CLI](https://github.com/ZeframLou/zklean); set
`ZKLEAN_CLI` if it is not on `PATH`.

```sh
bun run check:certificates  # every artifact matches its re-checked source
```

The repository is private, so the check verifies each committed export instead
of downloading the certificate's source URL.

`bun run prove` regenerates the requirements and each certificate with the Lean
export it was proved from, which the certificate names as its source. Review
the diff before committing. Prove with ZKLean's released guest so the
certificates verify under the SDK's pinned key: set `ZKLEAN_GUEST_ELF` to the
guest program and `ZKLEAN_PROFILE` to its verifier profile, and the prover
refuses to run if they disagree. The native prover needs Go 1.23 or newer.

Each proof takes minutes and several GiB of memory. To bound it:

```sh
RAYON_NUM_THREADS=4 GOMAXPROCS=2 GOMEMLIMIT=6GiB GOGC=20 \
ZKLEAN_PROVE_TIMEOUT=86400000 bun run prove
```

## Continuous integration

Set the `ZKLEAN_READ_TOKEN` Actions secret to a read-only token with Contents
access to `ZeframLou/zklean`. CI checks formatting, types, and tests, and runs
the example from npm tarballs with native tools unavailable. A second job
builds the pinned CLI and runs `bun run check:certificates`.

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
