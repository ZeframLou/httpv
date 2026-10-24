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
before deployment. A certificate is a few hundred bytes: the names of the
proved claims, the definitions they are about, and the axioms they use, each
with an **identity** (a hash of the declaration and everything it refers to),
plus a 260-byte proof. It also records its **source**: the URL of the Lean
export it was proved from, which `zklean prove` writes beside the certificate.
Publish that file so clients can review what the identities mean. To keep
proofs private, prove from a module that states the claims as axioms; the
identities are the same.

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

Each route binds an `operation`, the Lean definition of the endpoint's
behavior, to a certificate. The operation must be one of the certificate's
`definitions`; `serve` rejects it at startup otherwise. Paths match exactly.

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

Your **requirements** are the claims your client's proof assumes about the API
and the definitions they are about, by name and identity:

```json
{
  "format": "zklean/requirements/1",
  "claims": { "Inventory.reservation_safe": "56b0…" },
  "definitions": { "Inventory.POST_reservations": "9f2c…" }
}
```

Generate them from Lean code you have reviewed. To get the API's code, fetch
its certificate's source; ZKLean checks the export and fails unless every
identity matches the certificate, so a wrong pointer cannot mislead you, and it
never runs what it downloads:

```sh
zklean fetch --certificate approved.json --out vendor/inventory.ndjson
```

Then write requirements from that code, or from your own statements of what
you need, and commit the file:

```sh
zklean requirements --claims Inventory.reservation_safe \
  --definitions Inventory.POST_reservations --out specs/requirements.json
```

Statements can be `axiom`s: an identity covers what a declaration states, not
how it is proved, so an axiom matches a theorem with the same statement. Keep
requirements under your control; copying whatever the server advertises would
defeat the check.

## Check an API before using it

Describe the dependency once, then check it:

```ts
import { standardAxioms } from "zklean";
import { httpv } from "./httpv.ts";

const inventory = {
  url: "https://inventory.example.com/reservations",
  method: "POST",
  operation: "Inventory.POST_reservations",
  requirements: "./specs/requirements.json",
  axioms: { propext: standardAxioms.propext },
};

const result = await httpv.check(inventory);
if (result.status !== "verified")
  throw new Error(`inventory contract: ${result.status} (${result.reason})`);
```

`check` fetches the advertisement, verifies the certificate, confirms the
advertised operation is the one you expect, and compares identities with your
requirements. It never throws.

| Status         | Meaning                                                          | Reasons                                       |
| -------------- | ---------------------------------------------------------------- | --------------------------------------------- |
| `verified`     | The certificate is valid and establishes your requirements.      | `exact-match`, `bridge`                       |
| `incompatible` | The certificate is valid but does not establish your requirements. | `operation-mismatch`, `requirements-not-met` |
| `unknown`      | Nothing could be established.                                    | Discovery, certificate, bridge or configuration failures |

Every required definition, the operation included, must be certified with the
same identity; otherwise the result is `incompatible / operation-mismatch`. An
exact match also needs every required claim certified with the same identity.
The server may certify extra claims and definitions. Because identities hash
names as well as content, a matching theorem name with a changed statement, or
a redefined operation, never matches.

`axioms` lists the unproved assumptions you accept, by name and identity.
`standardAxioms` from ZKLean holds Lean's `propext`, `Quot.sound`, and
`Classical.choice`; `{}` accepts only certificates that use none. A certificate
using an axiom you did not list is `unknown / forbidden-axiom`, and one whose
axiom has a different identity is `unknown / axiom-mismatch`.

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

Here `Remote` is the API's published Lean source, with
`Inventory.reservation_safe` stated as an `axiom` so the bridge assumes it rather
than reproving it. Certify the proof with ZKLean, then add the bridge to the
dependency:

```ts
const result = await httpv.check({
  ...inventory,
  bridge: await Bun.file("./specs/bridge.json").json(),
});
```

HTTPV tries an exact match first, then the bridge. It verifies the bridge with
a policy of your `axioms` plus the API's certified claims, so the bridge may
assume only those, with the same identities, and it must prove every required
claim. A bridge cannot change the required definitions: a renamed or redefined
operation needs new, reviewed requirements.

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

## Local development

HTTPS is required and redirects are rejected. For a local server, add
`allowInsecureHttp: true` to the dependency.
