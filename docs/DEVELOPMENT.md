# Development

This guide is for contributors to HTTPV: how to run its checks, and how to
regenerate and release the example's certificates. To use HTTPV in an
application, see the [usage guide](USAGE.md).

## Set up

Install Bun 1.4.4 or newer, then run:

```sh
git clone https://github.com/ZeframLou/httpv.git
cd httpv
bun install --frozen-lockfile
bun run check
```

`check` runs the type checker and the tests. They, and `bun run example`, need
only Bun: ZKLean's package verifies certificates without native tools.

## Current state

The example certificates in `examples/inventory/certificates` predate the
current certificate format and are waiting to be re-proved. Until they are:

- `bun run example` blocks all three versions with `unknown (unavailable)`;
- `tests/groth16.test.ts` is skipped;
- `bun run check:certificates` and CI's `formal-artifacts` job fail;
- the certificates' source exports (`*.ndjson`) are not committed yet.

## Repository layout

- `src/`: the library. `server.ts` answers discovery, `client.ts` fetches and
  checks certificates, and `protocol.ts` holds the wire format.
- `tests/`: most tests make certificates from made-up identities and sign them
  with a test-only key in place of a real proof, so they run in milliseconds.
  `tests/groth16.test.ts` checks the real example certificates with ZKLean's
  verifier.
- `examples/inventory/`: the example's Lean project, requirements and
  certificates. `scripts/models.ts` lists each module's claims and output
  path.
- `examples/upgrades.ts`: the example server and client.

## Check the example's artifacts

`bun run check:certificates` rebuilds the example's Lean project and confirms
that the committed requirements, certificates and exports all match it. It
needs the ZKLean command-line tool from release v0.1.0, set up as in ZKLean's
[usage guide](https://github.com/ZeframLou/zklean/blob/v0.1.0/docs/USAGE.md#set-up),
and `ZKLEAN_CLI` set to that checkout's `src/cli.ts`:

```sh
export ZKLEAN_CLI=/path/to/zklean/src/cli.ts
bun run check:certificates
```

It uses the committed exports, never downloading the certificates' sources.

## Regenerate the example's artifacts

`bun run prove` regenerates the requirements and each certificate, with the
export it was proved from, which the certificate names as its source. It needs
`ZKLEAN_CLI` as above and ZKLean's prover setup from the same guide, including
`ZKLEAN_GUEST_ELF`.

Each example proof takes about 5 to 15 minutes and up to 20 GB of memory on a
12-core machine. Run one proof at a time. These variables cap the prover's
threads and the heap of its final proving step, which use more memory without
the caps:

```sh
RAYON_NUM_THREADS=6 GOMAXPROCS=2 GOMEMLIMIT=6GiB GOGC=20 bun run prove
```

Each proof times out after ZKLean's default of one hour. To change it, set
`ZKLEAN_PROVE_TIMEOUT` in milliseconds; `bun run prove` passes it to ZKLean's
`--timeout`.

Review the diff before committing.

## Continuous integration

CI checks formatting, types and tests, and runs the example with no native
tools or Lean installed. A second job builds the pinned ZKLean tool and runs
`bun run check:certificates`. While `ZeframLou/zklean` is private, set the
`ZKLEAN_READ_TOKEN` Actions secret to a read-only token with Contents access to
it.

## Release

1. Regenerate the example's artifacts, run `bun run check` and
   `bun run check:certificates`, and commit the certificates and their exports.
2. Tag the commit with the regenerated artifacts with the `version` in
   `package.json`, such as `v0.1.0`, and push the tag. Each certificate names
   its export at that tag, so clients can fetch its definitions only once the
   tag exists.
3. Once the matching `zklean` version is on npm, publish HTTPV from an npm
   account that owns the `httpv` package:

   ```sh
   npm pack --dry-run  # lists the files that will be published
   npm publish
   ```
