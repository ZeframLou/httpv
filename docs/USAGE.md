# Using HTTPV

## Install

The npm packages are not published yet. Until they are, use the
[tarball workflow](DEVELOPMENT.md#check-unpublished-packages). After publication:

```sh
npm install httpv
```

You can also use `bun add httpv`. HTTPV runs on [Bun](https://bun.sh/) 1.4.4 or
newer. For TypeScript checking, add `@types/bun` as a development dependency.

From a source checkout, `bun run example` serves three versions of a real
certificate and blocks requests once the third breaks the client's
requirement. Its certificates are being regenerated for the current format, so
it fails until they are.

## Serve a certificate

Generate each endpoint's certificate with
[ZKLean](https://github.com/ZeframLou/zklean-dist) before deployment. A
certificate is a few hundred bytes:

- **claims:** the proved theorems, each with an **identity**, a hash of the
  theorem's statement and of everything it refers to, including the endpoint's
  Lean function;
- **axioms:** the unproved assumptions the proofs use, with their identities;
- **proof:** 260 bytes that prove the claims under those axioms;
- **source:** the URL of the Lean export the certificate was proved from, which
  `zklean prove` writes beside the certificate. Publish that file so clients
  can review what the identities mean. To keep proofs private, prove from a
  module that states the claims as axioms; the identities are the same.

Wrap your existing Fetch handler:

```ts
import { serve } from "httpv";
import { fetch as application } from "./app.ts";

Bun.serve({
  port: 3000,
  ...serve({
    routes: {
      "POST /reservations": await Bun.file("./certs/reservations.json").json(),
    },
    fetch: application,
  }),
});
```

HTTPV answers `OPTIONS` requests that accept `application/httpv+json`. Every
other request goes to your handler, including CORS preflight requests, so your
CORS policy applies as usual. Serving needs no verifier. Paths match exactly.

Give each endpoint its own certificate, with claims about that endpoint's
behavior, so changing one endpoint never disturbs clients of another.

To change a certificate without restarting, pass a function instead. It runs on
every discovery request:

```ts
"POST /reservations": () => Bun.file("./certs/reservations.json").json(),
```

Serve over HTTPS, and deploy each certificate with the behavior it describes.

## Create a client

Save this as `httpv.ts`:

```ts
import { createHTTPV } from "httpv";

export const httpv = createHTTPV();
```

The client verifies certificates with ZKLean's embedded WebAssembly verifier and
the verifying key pinned in the SDK, never a key from the API being checked. It
needs no native executable, prover, or Lean process.

To use another verifier, pass `createHTTPV({ backend })`. A backend has an
`identity` string describing its trusted configuration and an async
`verify(certificate)` returning a boolean. It is trusted to authenticate the
entire certificate.

## Write your requirements

Your **requirements** are the claims your code relies on, by name and identity:

```json
{
  "format": "zklean/requirements/1",
  "claims": { "Inventory.reservation_safe": "56b0…" }
}
```

Write them from Lean code you have reviewed. To get the API's code, fetch the
source its certificate names. ZKLean checks the export and fails unless every
identity matches the certificate, so a wrong pointer cannot mislead you, and it
never runs what it downloads:

```sh
zklean fetch --certificate reservations.json --out vendor/inventory.ndjson
```

State the claims you rely on in a Lean module, then generate the requirements
from it and commit the result:

```sh
zklean requirements --project specs --module Requirements \
  --claims Inventory.reservation_safe --out specs/requirements.json
```

The module can state claims as `axiom`s: an identity covers what a declaration
states, not how it is proved, so an axiom matches a theorem with the same
statement.

- Make sure the claims are about the function the endpoint implements. Their
  identities then fix that function's definition.
- If your code needs a weaker property than the API certifies, prove it from
  the API's claims in your own Lean code and require the API's claims.
- Keep requirements under your control. Copying whatever the server advertises
  would defeat the check.

## Check an endpoint

Describe the endpoint once, then check it:

```ts
import { standardAxioms } from "zklean";
import { httpv } from "./httpv.ts";

const inventory = {
  url: "https://inventory.example.com/reservations",
  method: "POST",
  requirements: "./specs/requirements.json",
  axioms: { propext: standardAxioms.propext },
};

const result = await httpv.check(inventory);
if (result.status !== "verified")
  throw new Error(`inventory contract: ${result.status} (${result.reason})`);
```

`check` fetches the endpoint's certificate, verifies it, and compares its claim
identities with your requirements. It never throws.

| Status         | Meaning                                                              | Reason                 |
| -------------- | -------------------------------------------------------------------- | ---------------------- |
| `verified`     | The certificate is valid and proves every required claim.            | `exact-match`          |
| `incompatible` | The certificate is valid, but a required claim is missing or changed. | `requirements-not-met` |
| `unknown`      | Nothing could be established.                                        | See below              |

`unknown` reasons are `unavailable`, `missing-certificate` and
`invalid-advertisement` for discovery; `invalid-certificate`,
`forbidden-axiom`, `axiom-mismatch` and `verifier-unavailable` for the
certificate; `invalid-requirements` for your requirements file; and `timeout`,
`expired` and `stopped` from a monitor.

The server may certify extra claims. Because identities hash names and content,
a theorem with the same name but a changed statement, or about a redefined
function, never matches.

`axioms` lists the unproved assumptions you accept, by name and identity.
`standardAxioms` from ZKLean holds Lean's `propext`, `Quot.sound`, and
`Classical.choice`; `{}` accepts only certificates that use none. A certificate
using an axiom you did not list is `unknown / forbidden-axiom`, and one whose
axiom has a different identity is `unknown / axiom-mismatch`.

For lower-level control, `httpv.query(url, { method })` returns the endpoint's
certificate, throwing a `DiscoveryError` if discovery fails, and
`httpv.compare(certificate, requirement)` runs the rest of the check. Discovery
gives up after `timeout` milliseconds, 10 s by default, even if you also pass a
`signal`.

## Monitor updates

APIs change without telling their clients. `watch` rechecks an endpoint on an
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

Call `requireVerified()` wherever a request depends on the endpoint. It throws
unless the latest result is `verified` and younger than `maxAge`.

`onChange` is for notifications. It runs on the first result, when a verified
result expires, and whenever the status, reason, or certified statement
changes. If it throws, monitoring continues, but the error is reported as
uncaught, which ends a Bun process unless you handle `uncaughtException`.

| Setting    | Default              | Meaning                                        |
| ---------- | -------------------- | ---------------------------------------------- |
| `interval` | required             | Delay between checks, in milliseconds.         |
| `timeout`  | `10_000`             | Limit on one check, including verification.    |
| `maxAge`   | `interval + timeout` | Age at which a verified result stops counting. |
| `signal`   | none                 | Stops the monitor when aborted.                |

`monitor.refresh()` runs a check now; simultaneous calls share one.
`monitor.current` returns the latest result, and `stop()` ends polling and
invalidates the result. Polling cannot tell you what the server does between
checks.

## Local development

HTTPS is required and redirects are rejected. For a local server, add
`allowInsecureHttp: true` to the dependency.
