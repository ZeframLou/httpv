# Using HTTPV

## Install

The npm packages are not published yet. Until they are, use the
[tarball workflow](DEVELOPMENT.md#check-unpublished-packages). After publication:

```sh
npm install httpv
```

You can also use `bun add httpv`. HTTPV runs on [Bun](https://bun.sh/) 1.4.4 or
newer. For TypeScript checking, add `@types/bun` as a development dependency.

To see the whole workflow before integrating, run the example from a source
checkout. It serves three versions of a real certificate and blocks requests
once the third breaks the client's requirement:

```sh
bun run example
```

## Serve a certificate

Generate the API's certificate with [ZKLean](https://github.com/ZeframLou/zklean-dist)
before deployment. Its Lean model must describe the operation, inputs, and
resource it covers.

Wrap your existing Fetch handler:

```ts
import { serve } from "httpv";
import { fetch as application } from "./app.ts";

const certificate = await Bun.file("./certs/reservations.json").json();

Bun.serve({
  port: 3000,
  ...serve({
    routes: {
      "POST /reservations": {
        operation: "Inventory.POST_reservations",
        certificate,
      },
    },
    fetch: application,
  }),
});
```

HTTPV answers `OPTIONS` requests that accept `application/httpv+json`; every
other request goes to your handler. Serving needs no verifier.

Each route binds an `operation`, the Lean declaration that defines the
endpoint's behavior, to a certificate. The operation must be part of what the
certified claims depend on; `serve` rejects it at startup otherwise. Paths match
exactly.

To change the certificate without restarting, pass a function instead. It runs
on every discovery request and returns both fields together:

```ts
"POST /reservations": async () => ({
  operation: "Inventory.POST_reservations",
  certificate: await Bun.file("./certs/reservations.json").json(),
}),
```

Deploy each certificate with the behavior it describes, and serve it over HTTPS.

## Create a client

```ts
import { createHTTPV } from "httpv";

export const httpv = createHTTPV();
```

The client verifies certificates with ZKLean's embedded WebAssembly verifier and
the checker key pinned in the SDK, never a key from the API being checked. It
needs no native executable, prover, or Lean process.

To use another verifier, pass `createHTTPV({ backend })`. A backend has an
`identity` string describing its trusted configuration and an async
`verify(certificate)` returning a boolean. It is trusted to authenticate the
entire certificate.

## Choose your requirements

Your **requirements** are a local snapshot of the Lean statements and
definitions your client's proof assumes about the API. Keep them under your
control: accepting whatever the server advertises would defeat the check.

To require exactly what a reviewed certificate states, write its snapshot once
and commit it:

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

You can also generate a snapshot from your own Lean declarations with
[`zklean requirements`](https://github.com/ZeframLou/zklean-dist/blob/main/docs/USAGE.md).

## Check an API before using it

Describe the dependency once, then check it:

```ts
import { httpv } from "./httpv.ts";

const inventory = {
  url: "https://inventory.example.com/reservations",
  method: "POST",
  operation: "Inventory.POST_reservations",
  requirements: "./specs/requirements.json",
  allowedAxioms: ["propext"],
};

const result = await httpv.check(inventory);
if (result.status !== "verified")
  throw new Error(`inventory contract: ${result.status} (${result.reason})`);
```

`check` fetches the advertisement, verifies the certificate, confirms the
advertised operation is the one you expect with the same definition, and
compares the certificate with your requirements. It never throws.

| Status         | Meaning                                                          | Reasons                                       |
| -------------- | ---------------------------------------------------------------- | --------------------------------------------- |
| `verified`     | The certificate is valid and establishes your requirements.      | `exact-match`, `bridge`                       |
| `incompatible` | The certificate is valid but does not establish your requirements. | `operation-mismatch`, `requirements-not-met` |
| `unknown`      | Nothing could be established.                                    | Discovery, certificate, bridge or configuration failures |

An exact match requires every required statement, and everything it depends
on, to be certified with identical definitions. Bound-variable names may differ
and the server may certify extra statements. A matching theorem name alone is
not enough: if the API redefines `Inventory.POST_reservations`, the result is
`incompatible / operation-mismatch`.

`allowedAxioms` lists the unproved assumptions you accept. `["propext"]` permits
the axiom Lean's arithmetic lemmas use; `[]` accepts only certificates with
none. A custom axiom also needs its reviewed fingerprint in `axiomPins`;
otherwise the result is `unknown / unpinned-axiom`.

For lower-level control, `httpv.query(url, { method })` returns the
advertisement, throwing a `DiscoveryError` if discovery fails, and
`httpv.compare(advertisement, requirement)` runs the rest of the check.
Discovery gives up after `timeout` milliseconds, 10 s by default, even if you
also pass a `signal`.

## Use a weaker requirement

Exact matching never infers that one statement implies another. If your proof
needs less than the API guarantees, prove the implication in Lean and supply the
result as a **bridge**: a certificate proving your requirements while assuming
the API's certified claims.

For example, the API guarantees a positive quantity, enough stock, and
conservation, and your client only needs conservation:

```lean
import Remote

theorem Client.stock_conserved (available requested remaining : Nat) :
    Inventory.POST_reservations available requested = some remaining →
      remaining + requested = available := by
  intro accepted
  exact (Inventory.reservation_safe available requested remaining accepted).2.2
```

Follow ZKLean's [import and bridge guide](https://github.com/ZeframLou/zklean-dist/blob/main/docs/USAGE.md)
to import the API's public model as `Remote.lean` and certify this proof. Then
add the bridge to the dependency:

```ts
const result = await httpv.check({
  ...inventory,
  bridge: await Bun.file("./specs/bridge.json").json(),
});
```

HTTPV tries an exact match first, then the bridge. It verifies the bridge
independently and accepts it only if it assumes nothing beyond the API's
verified claims and your `allowedAxioms`, and every definition it shares with
the API is identical. A bridge cannot change which operation the endpoint is.
A renamed or redefined operation needs new, reviewed requirements.

## Monitor updates

APIs change without telling their clients. `watch` rechecks a dependency on an
interval:

```ts
const monitor = httpv.watch(inventory, {
  interval: 60_000,
  onChange: (result) => console.log(result.status, result.reason),
});

async function reserve(quantity: number) {
  monitor.requireVerified();
  return fetch(inventory.url, {
    method: "POST",
    body: JSON.stringify({ quantity }),
  });
}

process.on("SIGTERM", () => monitor.stop());
```

Call `requireVerified()` wherever a request depends on the contract. It throws
unless the latest result is `verified` and younger than `maxAge`. `onChange` is
for notifications: it runs on the first result, when a verified result
expires, and whenever the status, reason, advertised operation, or certificate
changes. Monitoring continues if it
throws, but the error is reported as uncaught, which ends a Bun process unless
you handle `uncaughtException`.

| Setting    | Default              | Meaning                                         |
| ---------- | -------------------- | ----------------------------------------------- |
| `interval` | required             | Delay between checks, in milliseconds.          |
| `timeout`  | `10_000`             | Limit on one check, including verification.     |
| `maxAge`   | `interval + timeout` | Age at which a verified result stops counting.  |
| `signal`   | none                 | Stops the monitor when aborted.                 |

`monitor.refresh()` runs a check now; simultaneous calls share one.
`monitor.current` returns the latest result, and `stop()` ends polling and
invalidates the result.
Polling cannot tell you what the server does between checks.

## Bind requirements to Lean sources

A JSON snapshot is self-contained. If you instead pass a `.lean` path, HTTPV
loads the sidecar `<path>.zklean.json`, which you generate during development:

```sh
zklean requirements --project specs --module Requirements \
  --claims Client.stock_conserved --out specs/Requirements.lean.zklean.json
```

The sidecar records digests of the source, its imports, Lake project files, and
toolchain. If any recorded file is missing or changed, the result is
`unknown / invalid-requirements`. Regenerate and review the sidecar after
editing the sources. HTTPV never runs Lean.

## Local development

HTTPS is required and redirects are rejected. For a local server, add
`allowInsecureHttp: true` to the dependency.
