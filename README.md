# HTTPV

**Know that an API broke the promise your code depends on, before your next
request.**

HTTPV is an HTTP protocol and TypeScript library for Bun. API teams publish
machine-checkable proofs of how their endpoints behave. Client teams check
those proofs with one function call, in under a second, with no Lean needed.
Ordinary requests and responses are unchanged.

- **Client teams** stop calling an API as soon as their next check finds it no
  longer guarantees what their code needs.
- **API teams** get a contract clients can verify, so a breaking change shows
  up in review instead of in a customer's incident.

It works with APIs whose team publishes proofs, so it suits internal services
and partner APIs first.

## Why

Docs and changelogs are promises your code can't check. Say your checkout
relies on an inventory service's `POST /reservations` never reserving more
stock than it has. One day the service starts accepting backorders. Your code
hasn't changed and every request still succeeds, but you are now selling stock
that doesn't exist, and nothing tells you.

With HTTPV, the inventory team models the endpoint as a small function in Lean,
a language for writing machine-checked proofs. It proves "a reservation never
exceeds available stock" and publishes a certificate of that proof next to the
endpoint. Your client names the guarantees it relies on and rechecks the
certificate on a schedule:

- **They add a guarantee:** the check still passes.
- **They drop or change one you rely on:** the check fails, so your code can
  block the request, switch provider or alert someone before a bad order goes
  through.

Any change to the function, even a refactor, fails the check until your team
reviews and accepts it, so nothing changes under you unseen. The proof covers
the Lean model, and the API team keeps the model in step with its code, as it
does its tests.

## See it work

[`examples/upgrades.ts`](examples/upgrades.ts) serves three versions of the
inventory endpoint and checks each one the way a client would:

```text
$ git clone https://github.com/ZeframLou/httpv.git && cd httpv
$ bun install && bun run example
V1: verified (exact-match) -> {"remaining":2}
V2 adds a guarantee: verified (exact-match) -> {"remaining":1}
V3 accepts backorders: incompatible (requirements-not-met) -> request blocked
```

Version 2 adds a guarantee and still passes. Version 3 starts accepting
backorders, so the client blocks it.

## How it works

```text
 API author                     API server                       Client
 ──────────                     ──────────                       ──────
 Lean function + theorems       answers OPTIONS /reservations    1. verify the certificate
        │ zklean prove          with the certificate        ──▶  2. compare its claims with
        ▼                       for POST                            your requirements
    certificate          ──▶                                     3. call, or block
```

1. The API author proves the guarantees once per release with
   [ZKLean](https://github.com/ZeframLou/zklean): about 5 to 15 minutes for a
   small model. The result is a certificate, typically under 1 KB.
2. The server answers an HTTP `OPTIONS` request to the endpoint's own URL with
   that certificate. It also publishes, as one file, the Lean definitions the
   certificate describes.
3. The client verifies the certificate in under a second, without Lean
   installed, and checks that it still proves every guarantee the client
   relies on.

## Get started

HTTPV runs on [Bun](https://bun.sh/) 1.4.4 or newer. Install it with the ZKLean
SDK it builds on:

```sh
bun add zklean@0.1.0 httpv@0.1.0
```

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

**Client:** list the guarantees you rely on, and check before relying on the
endpoint.

```ts
import { createHTTPV, standardAxioms } from "httpv";

const result = await createHTTPV().check({
  url: "https://inventory.example.com/reservations",
  method: "POST",
  requirements: "./requirements.json", // the guarantees you rely on
  axioms: standardAxioms, // the assumptions you accept; see Concepts
});
if (result.status === "verified")
  await fetch("https://inventory.example.com/reservations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quantity: 1 }),
  });
```

The [usage guide](docs/USAGE.md) walks both teams through it: writing the Lean
model, generating `requirements.json`, and rechecking on a schedule. The
[protocol specification](SPEC.md) defines the wire format for other
implementations.

## Concepts

- **Certificate:** what ZKLean produces. It lists the proved theorems, called
  **claims**, with a short cryptographic proof that ZKLean's independent Lean
  checker accepted them. Anyone can verify that proof without the Lean proofs.
- **Identity:** a fingerprint of a claim and the code it is about. Change
  either and the identity changes; re-proving the same thing doesn't.
- **Requirements:** the claims your code relies on, with their identities. A
  check passes only if the certificate proves all of them.
- **Axioms:** statements a proof assumes without proving. A false axiom can
  prove anything, so your client accepts only the ones it lists, normally
  Lean's three standard axioms (`standardAxioms`).

## Trust model

Clients verify each certificate themselves, trusting only ZKLean's checker and
its cryptography, their own requirements, and the axioms they accept. A pass
means the API's Lean model has every property the client requires; the client
trusts the server to run code that behaves as that model does. HTTPV does not
detect a server that misbehaves behind an unchanged certificate, or a change
between two checks.

## License

[MIT NON-AI License](LICENSE).
