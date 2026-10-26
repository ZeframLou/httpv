# HTTPV

**Formal verification for HTTP endpoints**

HTTPV is a standard for serving [ZKLean](https://github.com/ZeframLou/zklean)
certificates from HTTP endpoints, and a TypeScript library for Bun that serves
and checks them. API teams publish formal specs of how their endpoints behave,
written in [Lean](https://lean-lang.org/) (a language for machine-checked
proofs), with a 1 KB certificate that the specs are proved. Client teams check
it in under a second, without the proofs and without installing Lean.

## Why

Say your shopping site's checkout relies on an inventory service's
`POST /reservations` never reserving more stock than it has. One day the service
starts accepting backorders. Your code hasn't changed and every request still
succeeds, but you are now selling stock that doesn't exist, and nothing tells
you.

Docs and changelogs can't catch this; they are promises your code can't check,
and often the behavioral change is a bug that even the API team doesn't know
about. Formal proofs can, but today you would have to fetch the inventory team's
Lean project and re-check its proofs on every deploy. Those proofs are thousands
of lines for a small service and 10k–100k+ for a production one, so nobody does,
and you find out from an incident.

With HTTPV, the inventory team proves "a reservation never exceeds available
stock" in Lean and serves a ZKLean certificate next to the endpoint. The
certificate carries a succinct (356 bytes) zero-knowledge proof that a valid
proof exists, and your client code can check it in under a second. When the
guarantee you rely on changes, the check fails and your code blocks the request,
switches provider or alerts someone before a bad order goes through.

Your own formal specs can then build on the inventory team's: their proved
guarantees become dependencies of your proofs.

## What you get

- **Breaking changes and bugs caught before the request.** A changed or dropped
  guarantee fails the check, whether the API team meant it or not; added
  guarantees and unrelated changes pass.
- **Cheap checks.** One function call, under a second, with no Lean installed.
- **Precise claims.** Each guarantee is pinned by a fingerprint of its exact
  statement and the endpoint model it describes, so a rename can't hide a
  change.
- **A drop-in server.** `serve` wraps your existing handler. Ordinary requests
  and responses are unchanged.
- **Explicit assumptions.** Your client accepts only the axioms (unproved
  assumptions) you list.

## Install

```sh
bun add zklean@0.1.0 httpv@0.1.0
```

HTTPV runs on [Bun](https://bun.sh/) 1.4.4 or newer. Proving certificates uses
ZKLean's command-line tool; see its
[usage guide](https://github.com/ZeframLou/zklean/blob/v0.1.0/docs/USAGE.md#set-up).

## Try it

[`examples/upgrades.ts`](examples/upgrades.ts) serves three versions of the
inventory endpoint and checks each one the way a client would:

```text
$ git clone https://github.com/ZeframLou/httpv.git && cd httpv
$ bun install && bun run example
V1: verified (exact-match) -> {"remaining":2}
V2 adds a guarantee: verified (exact-match) -> {"remaining":1}
V3 accepts backorders: incompatible (requirements-not-met) -> request blocked
```

## Example

**Server:** serve each endpoint's certificate alongside your existing handler.

```ts
import { serve } from "httpv";

Bun.serve({
  ...serve({
    // reservations.json is the certificate `zklean prove` wrote.
    routes: {
      "POST /reservations": await Bun.file("reservations.json").json(),
    },
    fetch: app, // your existing request handler
  }),
});
```

**Client:** check the guarantees you rely on before each call.

```ts
import { createHTTPV, standardAxioms } from "httpv";

const result = await createHTTPV().check({
  url: "https://inventory.example.com/reservations",
  method: "POST",
  requirements: "./requirements.json",
  axioms: standardAxioms, // the assumptions you accept
});
if (result.status === "verified")
  await fetch("https://inventory.example.com/reservations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quantity: 1 }),
  });
```

## Practical workflow

1. **Publish.** The API team proves its guarantees with ZKLean once per release,
   in about 5 to 15 minutes for a small model, and serves the certificate.
2. **Pin.** Your team reviews the theorems it relies on once, in Lean, and
   records their fingerprints in `requirements.json` with
   `zklean requirements`.
3. **Check.** Your client checks the endpoint before relying on it, or on a
   schedule you choose. Only a change to a guarantee you pinned fails.

## How it works

```text
client ── OPTIONS /reservations ─────────────▶ server (serve)
       ◀─ {"format":"httpv/1",
            "certificates":{"POST": certificate}} ─
client: verify certificate (ZKLean) ─▶ compare with requirements ─▶ status
```

- **Discovery.** A client asks for an endpoint's certificates with an `OPTIONS`
  request to the endpoint's own URL. The server answers with an
  `application/httpv+json` document mapping each HTTP method to its ZKLean
  certificate, with `Cache-Control: no-store`.
- **Server.** `serve` answers those `OPTIONS` requests for the routes you
  configure and passes every other request, with all its arguments, to your
  handler.
- **Client.** `createHTTPV().check` fetches the document over https, refusing
  redirects, within one deadline for the whole check. It verifies the
  certificate with ZKLean's verifier under your axioms, then compares its
  claims with your requirements by name and fingerprint. The result is
  `verified`, `incompatible` (the certificate is valid but doesn't prove what
  you require) or `unknown` (discovery or verification failed), with a reason.
- **Certificates** come from ZKLean; its
  [README](https://github.com/ZeframLou/zklean#how-it-works) explains how they
  are proved and verified.

## Trust model

Clients verify each certificate themselves, trusting only ZKLean's checker and
its cryptography, their own requirements, and the axioms they accept. A pass
means the API's Lean model has every property the client requires; the client
still trusts the server to run code that behaves as that model does. HTTPV
cannot see a server that misbehaves behind a valid certificate, or a change
between two checks.

## More

- The [usage guide](docs/USAGE.md) walks both teams through writing the Lean
  model, generating `requirements.json` and checking on a schedule.
- The [specification](SPEC.md) defines the wire format for other
  implementations.

## License

[MIT NON-AI License](LICENSE).
