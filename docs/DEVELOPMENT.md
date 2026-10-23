# Development

For application integration, see the [usage guide](USAGE.md).

Install Bun 1.4.4 and authenticate Git for read access to the private
`ZeframLou/zklean` repository, then run:

```sh
bun install --frozen-lockfile
bun run check
```

Development pins ZKLean to a Git commit. Published HTTPV requires the npm
`zklean@0.1.0` SDK as a peer dependency, which npm installs automatically.
HTTPV imports only its public package exports; no sibling checkout, Rust
compiler, or SP1 toolchain is needed for the transport and policy tests.

The dependency URL selects Git transport so ordinary Git credentials work for
the private repository; see [Bun's private GitHub dependency issue](https://github.com/oven-sh/bun/issues/19618).

## Publish to npm

Publish the `zklean@0.1.0` SDK from the ZKLean repository first, then publish
HTTPV. In each repository, run:

```sh
bun run check
npm pack --dry-run
npm publish
```

The SDK contains TypeScript APIs; it does not install or build the native
prover. HTTPV's package contains its runtime source and documentation. Git pins
are development dependencies and are not fetched by consumers.

## Continuous integration

Set the repository's `ZKLEAN_READ_TOKEN` Actions secret to a read-only token
with Contents access to `ZeframLou/zklean`. CI uses it only to fetch the private
dependency. The workflow checks formatting, TypeScript, and HTTP end-to-end tests.

## Test real proof verification

The transport tests sign frozen statements that were checked by Nanoda when
created. They exercise discovery, compatibility, axiom policy, and monitoring;
the signature backend is test-only. An additional test verifies a real compressed
STARK certificate through the ZKLean adapter when a native verifier is available:

```sh
ZKLEAN_NATIVE="$HOME/.local/libexec/zklean-native" bun test
```

## Regenerate model fixtures

Install the [ZKLean CLI](https://github.com/ZeframLou/zklean) and run:

```sh
bun run fixtures
```

The script builds the Lean examples and checks them through the public CLI.
`tests/fixtures/*.statement.json` are complete public models, not replacement
cryptographic proofs. `requirements.json` is the client's local requirement
snapshot. The committed identity certificate and verifier profile originate
from ZKLean's cryptographic integration test.

## Run the upgrade demonstration

```sh
bun scripts/prove-examples.ts
bun run example
```

Proof generation runs offline before starting the server. The demo independently
checks its requirement against three advertisements, continuing through a
compatible upgrade and blocking requests after backorders are introduced.
A separate Lean derivation establishes compatibility for a differently named
client requirement.

The example reads the trusted verifier configuration from the installed CLI's
`doctor` output. Set `ZKLEAN_CLI` when the executable is not on `PATH`.
