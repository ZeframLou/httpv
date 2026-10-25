# Using HTTPV

The [README](../README.md) explains the concepts: certificates, claims,
identities, axioms, and requirements.

## Install

```sh
npm install httpv zklean
```

You can also use `bun add httpv zklean`. HTTPV runs on [Bun](https://bun.sh/)
1.4.4 or newer. For TypeScript checking, add `@types/bun` as a development
dependency. Writing requirements also needs the
[ZKLean CLI](https://github.com/ZeframLou/zklean).

From a source checkout, `bun run example` serves three versions of a real
certificate and blocks requests once the third breaks the client's
requirement. Its committed certificates use an older format, so it currently
blocks all three versions with `unknown (unavailable)`.

## Serve a certificate

Generate each endpoint's certificate with `zklean prove` before deployment. A
certificate is typically under 1 KB; its size grows with the number of claims
and axioms, not with the size of the proofs. It holds:

- **claims:** the proved theorems, each with its identity;
- **axioms:** the unproved assumptions the proofs use, with their identities;
- **proof:** 260 bytes proving the claims under those axioms;
- **source:** the URL where you publish the Lean export behind the
  identities. `zklean prove` writes that export (`CERT.ndjson`) beside the
  certificate; pass its URL with `--source`. To keep proofs private, publish
  at that URL an export of a module that states the claims as axioms instead;
  identities do not cover proofs, so they are the same.

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

HTTPV answers discovery: `OPTIONS` requests that ask for
`application/httpv+json`. Every other request goes to your handler, including
`OPTIONS` for paths without certificates and CORS preflight requests. Paths
match exactly and the query is ignored. `serve` validates static certificates
when it is called.

Give each endpoint its own certificate, with claims about that endpoint's
behavior, so changing one endpoint never disturbs clients of another.

To change a certificate without restarting, pass a function instead. It runs on
every discovery request:

```ts
"POST /reservations": () => Bun.file("./certs/reservations.json").json(),
```

To let browsers on other origins read certificates, wrap the handler `serve`
returns and add your CORS headers to its responses.

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

Your requirements are a JSON file of claims and identities:

```json
{
  "format": "zklean/requirements/1",
  "claims": { "Inventory.reservation_safe": "56b0…" }
}
```

1. Get the API's Lean code and review the theorems your code relies on.
2. Generate requirements from that code, naming those theorems:

   ```sh
   zklean requirements --project vendor/inventory --module Inventory \
     --claims Inventory.reservation_safe --out requirements.json
   ```

   You can also state the claims yourself, as `axiom`s in your own module:
   an identity covers a statement, not its proof, so an axiom matches a theorem
   with the same statement.
3. Commit `requirements.json`.

If you only have the API's certificate, save it with
`httpv.query(url, { method })`, then fetch the export it names. ZKLean checks
the export and fails unless every identity matches the certificate, and never
runs what it downloads:

```sh
zklean fetch --certificate reservations.json --out vendor/inventory.ndjson
zklean requirements --export vendor/inventory.ndjson \
  --claims Inventory.reservation_safe --out requirements.json
```

Make sure the claims are about the function the endpoint implements; their
identities then fix that function's definition. If your code needs a weaker
property than the API certifies, prove it from the API's claims in your own
Lean code and require the API's claims. Never copy requirements from the
certificate you are about to check without reviewing them.

## Check an endpoint

Describe the endpoint once, then check it:

```ts
import { standardAxioms } from "zklean";
import { httpv } from "./httpv.ts";

const inventory = {
  url: "https://inventory.example.com/reservations",
  method: "POST",
  requirements: "./requirements.json", // relative to the working directory
  axioms: standardAxioms, // Lean's propext, Quot.sound and Classical.choice
};

const result = await httpv.check(inventory);
if (result.status !== "verified")
  throw new Error(`inventory contract: ${result.status} (${result.reason})`);
```

`check` fetches the endpoint's certificate, verifies it, and compares its claim
identities with your requirements. It never throws.

| Status         | Meaning                                                               | Reason                 |
| -------------- | --------------------------------------------------------------------- | ---------------------- |
| `verified`     | The certificate is valid and proves every required claim.             | `exact-match`          |
| `incompatible` | The certificate is valid, but a required claim is missing or changed. | `requirements-not-met` |
| `unknown`      | Nothing could be established.                                         | See below              |

`unknown` reasons:

- discovery: `unavailable` (network, timeout or server error),
  `missing-certificate` (no certificate for this method), and
  `invalid-advertisement` (a malformed discovery response);
- the certificate: `invalid-certificate`, `forbidden-axiom`, `axiom-mismatch`,
  and `verifier-unavailable`;
- your configuration: `invalid-requirements`, including requirements with no
  claims;
- a monitor: `timeout`, `expired`, and `stopped`.

The server may certify extra claims. Because identities hash names and content,
a theorem with the same name but a changed statement, or about a changed
function, never matches.

`axioms` lists the axioms you accept, by name and identity. `{}` accepts only
certificates that use none. A certificate using an axiom you did not list is
`unknown / forbidden-axiom`, and one whose axiom has a different identity is
`unknown / axiom-mismatch`.

For lower-level control, `httpv.query(url, { method })` returns the endpoint's
certificate, throwing a `DiscoveryError` if discovery fails, and
`httpv.compare(certificate, requirement)` runs the rest of the check. Discovery
gives up after `timeout` milliseconds, 10 s by default, even if you also pass a
`signal`.

## Monitor updates

`watch` rechecks an endpoint on an interval:

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
unless the latest result is `verified` and younger than `maxAge`, measured from
when that check started.

`onChange` is for notifications. It runs on the first result, when a verified
result expires, and whenever the status, reason, or certified claims change. If
it throws, monitoring continues, but the error is reported as uncaught, which
ends a Bun process unless you handle `uncaughtException`.

| Setting    | Default              | Meaning                                        |
| ---------- | -------------------- | ---------------------------------------------- |
| `interval` | required             | Delay between checks, in milliseconds.         |
| `timeout`  | `10_000`             | Limit on one check, including verification.    |
| `maxAge`   | `interval + timeout` | Age at which a verified result stops counting. |
| `signal`   | none                 | Stops the monitor when aborted.                |

`monitor.refresh()` runs a check now; simultaneous calls share one, and a
monitor never runs two checks at once. `monitor.current` returns the latest
result, and `stop()` ends polling and invalidates the result.

## Local development

HTTPS is required and redirects are rejected. For a server on this machine
(`localhost` or a loopback address), add `allowInsecureHttp: true` to the
dependency.
