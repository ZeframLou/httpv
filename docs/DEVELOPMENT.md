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
Both npm packages are currently unpublished. HTTPV imports only the SDK’s public
package exports; no sibling checkout, Rust
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
dependency. The workflow checks formatting, TypeScript, and HTTP end-to-end
tests. A separate formal-artifact job builds the pinned independent CLI,
regenerates every source model, rejects fixture drift, and authenticates the four
unit-inventory certificates against their freshly checked statements.

## Test real proof verification

The transport tests sign frozen statements that were checked by Nanoda when
created. They exercise discovery, compatibility, axiom policy, and monitoring;
the signature backend is test-only. The mandatory crypto test verifies a real
Groth16 certificate through the default embedded ZKLean verifier and rejects
tampered evidence and a different valid model:

```sh
bun test tests/crypto.e2e.test.ts
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

## Run the real single-unit workflow

```sh
bun run example:unit
```

The committed certificates cover a real `POST /units` model that reserves one
unit from an inductive stock count. The workflow discovers V1, accepts V2's
additional guarantee, blocks V3's backorder behavior, derives a weaker client
requirement with a separately proved bridge, rejects entrypoint rebinding with an
unchanged valid certificate, and blocks tampered evidence. Its mandatory
integration test and installed npm consumer check run this same
example through public APIs and the default worker-backed Groth16 verifier.
No proving toolchain is needed to run it. The npm tarball includes the models,
certificates, and runnable example; in an installed Bun application run
`bun node_modules/httpv/examples/unit-upgrades.ts`.

Regenerate these proofs offline with the independent CLI and a measured CPU and
memory budget:

```sh
RAYON_NUM_THREADS=4 GOMAXPROCS=2 GOMEMLIMIT=6GiB GOGC=20 \
TRACE_GEN_WORKERS=1 CHECKPOINTS_CHANNEL_CAPACITY=1 \
RECORDS_AND_TRACES_CHANNEL_CAPACITY=1 ZKLEAN_PROVE_TIMEOUT=86400000 \
bun scripts/prove-examples.ts unit
```

The committed model fixtures are regenerated separately by `bun run fixtures`.
After regeneration and review, copy the four generated `examples/generated/unit/`
certificates into `examples/unit-inventory/certificates/` and run the checks below.
`bun run check:certificates` requires each actual certificate's statement to equal
its checked source fixture and verifies its real evidence under reviewed axiom
pins. CI regenerates the source fixtures before performing that comparison.

The raw [generation reports](unit-generation.json) record each proof’s wall time
and peak native-process RSS on a four-CPU, 16-GiB machine. V1 executes
33,839,014 guest cycles; its proof took about two hours and peaked at 12.8 GiB
RSS. Proof generation uses the pinned ZKLean guest, unmodified SP1 5.2.4, and
official ceremony artifacts. These measurements describe this workload rather than a minimum
hardware requirement.

## Run the arithmetic upgrade demonstration

```sh
ZKLEAN_PROVE_TIMEOUT=86400000 bun scripts/prove-examples.ts
bun run example
```

Proof generation runs offline before starting the server. The demo independently
checks its requirement against three advertisements, continuing through a
compatible upgrade and blocking requests after backorders are introduced.
A separate Lean derivation establishes compatibility for a differently named
client requirement.
The inventory models are expensive CPU proving workloads; the command above
allows up to a day per proof. Choose a time and memory budget using ZKLean's
measurements. `ZKLEAN_PROVE_TIMEOUT` forwards a timeout in milliseconds to the
CLI; without it, the CLI's default deadline applies.

The runtime example uses the SDK's embedded verifier and trusted checker key.
Only offline fixture and proof generation needs the separately installed CLI;
set `ZKLEAN_CLI` when that executable is not on `PATH`.

`examples/axioms.json` pins the reviewed example assumptions by their complete
dependency contexts. Source changes require reviewing and updating those pins;
do not accept producer-supplied fingerprints as application policy.

To check actual npm consumption without publishing, pack the tested ZKLean SDK
and pass its tarball to `bun scripts/check-package.ts PATH_TO_ZKLEAN_TARBALL`.
The script packs HTTPV, installs both tarballs with npm, and discovers and
verifies a real proof through their public APIs with native tools unavailable.
It does not fetch a private Git dependency or use a sibling source checkout.

## Check unpublished packages

Pack the SDK and HTTPV without publishing:

```sh
# In the ZKLean source checkout:
npm pack --pack-destination dist
# In the HTTPV source checkout:
mkdir -p dist
npm pack --pack-destination dist
```

In a separate Bun application, install the two prepared tarballs:

```sh
npm install /path/to/zklean-0.1.0.tgz /path/to/httpv-0.1.0.tgz
```

For the complete installed-consumer check, run
`bun scripts/check-package.ts /path/to/zklean-0.1.0.tgz` in HTTPV. It typechecks
and runs the real single-unit workflow with native tools unavailable. Package
publication, binary host creation, and releases remain separate maintainer actions.

## Cost and deployment policy

The measured identity and pipeline examples have larger complete certificates
and slower Groth16 verification than direct Nanoda checking. Proof generation
can take hours and use more than 12 GiB RSS. Use offline certificates when
proof privacy or recipient portability justifies that cost; direct source
checking remains available through the independent CLI. The single-unit fixture
covers the protocol workflow, while the arbitrary-quantity arithmetic example
has its own larger resource budget. No efficiency advantage is assumed.
