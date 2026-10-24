# Using HTTPV

## Install

Install from npm:

```sh
npm install httpv
```

You can also use `bun add httpv`. The examples run on [Bun](https://bun.sh/)
1.4.4 or newer and use its server and file APIs. Relative file paths resolve
from the directory where you run the application.
For TypeScript checking, add `@types/bun` as a development dependency if the
application does not already include Bun's types.

## Publish a certificate

Generate the API's certificate with [ZKLean](https://github.com/ZeframLou/zklean-dist)
before deployment and save it as `certs/reservations.json`. Its specification
must describe the operation, inputs, and resource it covers.

Wrap your application's existing Fetch handler, exported as `fetch` from
`app.ts` in this example. Save this as `server.ts`:

```ts
import { HTTPV } from "httpv";
import { fetch as application } from "./app.ts";

Bun.serve({
  port: 3000,
  ...HTTPV.serve({
    routes: {
      "POST /reservations": "./certs/reservations.json",
    },
    fetch: application,
  }),
});
```

Run `bun server.ts`. HTTPV handles `OPTIONS` requests that accept
`application/httpv+json`; other requests go to your handler. No verifier is
needed to serve certificates.

Route paths match exactly. A route value can be a file path, a certificate
object, or a function returning a certificate or a promise of one. Files and
functions are read on each discovery request, so you can update advertisements
without restarting the server. Deploy each certificate with the behavior it
describes, and expose the endpoint over HTTPS in production.

## Configure a client verifier

The npm installation supplies ZKLean's embedded WebAssembly verifier and pinned
checker key. Save this as `httpv.ts`:

```ts
import { createHTTPV } from "httpv";

export const httpv = createHTTPV();
```

The trusted key comes from the SDK, never from the API being checked. Client
verification needs no native executable, prover, circuit download, or Lean
process. Generate certificates separately with the ZKLean CLI before deployment.

You can instead supply a `ProofBackend` with an `identity` string and an async
`verify(certificate)` method returning a boolean. That backend is trusted to
authenticate the entire certificate. Its identity must describe its trusted
checker configuration. The default instance uses ZKLean's embedded backend.

## Choose your requirements

Requirements are a local snapshot of the statements and definitions your client
relies on. Keep them under your control; accepting whatever the server currently
advertises would defeat the compatibility check.

For an exact contract, start with a certificate whose model you have reviewed
and approved. Save it as `contracts/approved.json`, then run this once as
`bun requirements.ts`:

```ts
import { parseCertificate, requirementsFor } from "zklean";

const approved = parseCertificate(
  await Bun.file("./contracts/approved.json").json(),
);
await Bun.write(
  "./specs/requirements.json",
  JSON.stringify(requirementsFor(approved.specs)),
);
```

Commit the resulting snapshot with your client. You can also generate a
requirements snapshot from your own Lean declarations using
[`zklean requirements`](https://github.com/ZeframLou/zklean-dist/blob/main/docs/USAGE.md).

## Check an API before using it

Save this as `check.ts`, using your API's HTTPS URL:

```ts
import { httpv } from "./httpv.ts";

const url = "https://inventory.example.com/reservations";
const certificate = await httpv.query(url, { method: "POST" });
const result = await httpv.checkCompatibility({
  certificate,
  requirements: "./specs/requirements.json",
  allowedAxioms: ["propext"],
  mode: "exact",
});

if (result.status !== "verified") {
  throw new Error(`Inventory contract check failed: ${result.reason}`);
}

const response = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ quantity: 3 }),
});
console.log(response.status, await response.json());
```

Run `bun check.ts`. `query` retrieves a certificate; `checkCompatibility`
verifies it and compares its model with your requirements. Choose
`allowedAxioms` deliberately: `["propext"]` permits the axiom used by the
inventory example, while `[]` accepts only certificates with no axioms.

| Status         | Meaning                                                       |
| -------------- | ------------------------------------------------------------- |
| `verified`     | The certificate is valid and establishes your requirements.   |
| `incompatible` | The certificate is valid but fails the requested exact match. |
| `unknown`      | Verification or compatibility could not be established.       |

This example blocks requests unless the result is `verified`. A discovery
failure throws a `DiscoveryError` with reason `unavailable`,
`missing-certificate`, or `invalid-certificate`; the application also needs a
failure policy for these errors.

`mode: "exact"` requires the requested statements and all their resolved
definitions to match; bound-variable names and binder display annotations may
differ, and the server may advertise extra guarantees. A matching
theorem name alone is insufficient. `httpv.verify(certificate, { allowedAxioms })`
checks certificate validity only; use `checkCompatibility` to establish that
the API meets your requirements.

For local development, use `http://localhost:3000/reservations` and pass
`allowInsecureHttp: true` to `query` or `watch`. HTTPS is otherwise required;
redirects are rejected. `query` also accepts a timeout in milliseconds (default
`10_000`) and an `AbortSignal`.

## Accept a different specification

An API may establish your requirements through differently expressed guarantees.
Supply a **bridge certificate**: a separately checked Lean derivation showing
that those guarantees imply your requirements.

Replace the compatibility check above with:

```ts
const result = await httpv.checkCompatibility({
  certificate,
  requirements: "./specs/requirements.json",
  allowedAxioms: ["propext"],
  derivation: await Bun.file("./contracts/bridge.json").json(),
});
```

The default mode accepts an exact match or a valid bridge. A mismatch without
a bridge returns `unknown` with reason `missing-derivation`; it does not prove
that the specifications are logically incompatible. HTTPV verifies both
certificates and checks their shared definitions. See the
[compatibility rules](ENCODING.md) and [bridge example](../examples/lean/Bridge.lean).

## Monitor updates

Save this as `watch.ts`:

```ts
import { httpv } from "./httpv.ts";

const monitor = httpv.watch({
  url: "https://inventory.example.com/reservations",
  method: "POST",
  requirements: "./specs/requirements.json",
  allowedAxioms: ["propext"],
  mode: "exact",
  interval: 60_000,
  timeout: 10_000,
  maxAge: 90_000,
  onChange(result) {
    console.log(result.status, result.reason);
  },
  onError(error) {
    console.error(error);
  },
});

await monitor.refresh();

// Every dependent request checks the current, unexpired result.
async function reserve(quantity: number) {
  monitor.requireVerified();
  const response = await fetch("https://inventory.example.com/reservations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quantity }),
  });
  if (!response.ok) throw new Error(`Reservation failed: ${response.status}`);
  return response.json();
}

console.log(await reserve(3));
process.on("SIGINT", () => monitor.stop());
process.on("SIGTERM", () => monitor.stop());
```

Run `bun watch.ts`. Watching starts immediately and polls again after each
check. `onChange` must be synchronous; it runs for the first result and when the
status, reason, certificate identity, or model identity changes. Discovery
failures become `unknown` results delivered to `onChange`; `onError` handles
errors thrown by your change callback.

`timeout` bounds the complete discovery and verification cycle. A successful
result expires after `maxAge`, even if the next check stalls; its default is
`interval + timeout`. `requireVerified()` throws while unchecked, expired,
incompatible, unknown, or stopped. Use it at the point where a request depends
on the contract; callbacks are for notifications.

`monitor.current` returns a snapshot of the latest result, `refresh()` requests
a check, and `stop()` invalidates the result and cancels discovery and future
polling. Simultaneous refreshes share one check. Polling does not establish what
the server does between checks or bind a later response to a certificate.

For a complete inventory upgrade demonstration, see
[Development](DEVELOPMENT.md#run-the-upgrade-demonstration).

## Derive a weaker requirement

Exact matching does not discover arbitrary mathematical implications. To use a
stronger guarantee for a weaker client requirement, certify a separate Lean
derivation, called a bridge. Both the remote certificate and the bridge are
verified independently.

Follow ZKLean's [certificate import and bridge guide](https://github.com/ZeframLou/zklean-dist/blob/main/docs/USAGE.md)
to authenticate and inspect `certs/reservations.json`, import its public model
into `Remote.lean`, and prove this in a local Lake project:

```lean
import Remote

theorem Client.stock_conserved (available requested remaining : Nat) :
    Inventory.POST_reservations available requested = some remaining →
      remaining + requested = available := by
  intro accepted
  exact (Inventory.reservation_safe available requested remaining accepted).2.2
```

The remote guarantee also promises a positive quantity and sufficient stock;
this derivation extracts just the conservation property. The imported guarantee
is an explicit assumption for the separate bridge proof. ZKLean's authenticated
import writes the complete assumption fingerprints used when certifying it.

Keep the resulting `bridge.json` and the reviewed `requirements.json` snapshot
with the client. Supply the bridge to HTTPV:

```ts
const result = await httpv.checkCompatibility({
  certificate,
  requirements: "./specs/requirements.json",
  derivation: await Bun.file("./specs/bridge.json").json(),
  allowedAxioms: ["propext"],
});
if (result.status !== "verified") throw new Error(result.reason);
```

HTTPV permits a bridge to assume only authenticated remote claims and your
explicitly permitted axioms. It checks the assumed claims' complete types and
resolved dependency contexts. Binder display names may differ; changed
definitions with the same names require distinct or versioned contexts before
they can coexist in a bridge. Valid certificates alone do not establish an
implication between them.

## Bind a snapshot to local Lean sources

A JSON requirement snapshot is self-contained and can be deployed without Lean.
If the application instead passes a `.lean` path, generate its sidecar with the
CLI during development. For example:

```sh
zklean requirements --project specs --module Requirements \
  --claims Client.stock_conserved --out specs/Requirements.lean.zklean.json
```

`requirements: "./specs/Requirements.lean"` then loads that exact sidecar and
checks its source manifest before use. The manifest includes transitive source
imports, Lake project files, and toolchain artifacts. All recorded files must
remain available and unchanged; a stale or missing file returns
`requirements-unavailable`. Regenerate and review the snapshot after edits,
before a rebuild can hide an old source dependency. The runtime does not
elaborate Lean or create missing sidecars.
