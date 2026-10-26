# HTTPV

**Know when an API stops guaranteeing what your code depends on, before a bad
request goes through.**

HTTPV is a convention for serving proof certificates from HTTP endpoints, and a
TypeScript library for Bun that serves and checks them. API teams publish
machine-checkable proofs of how their endpoints behave. Client teams review a
guarantee once and pin it; after that they check each proof with one function
call, in under a second, with no Lean installed.
Ordinary requests and responses are unchanged.

API teams get a contract clients can verify, so a breaking change shows up in
review instead of in a customer's incident.

The API team must publish proofs, so HTTPV fits internal services and partner
APIs.

## Why

Docs and changelogs are promises your code can't check. Say your checkout
relies on an inventory service's `POST /reservations` never reserving more
stock than it has. One day the service starts accepting backorders. Your code
hasn't changed and every request still succeeds, but you are now selling stock
that doesn't exist, and nothing tells you.

With HTTPV, the inventory team models the endpoint as a small function in Lean,
a language for writing machine-checked proofs. It proves "a reservation never
exceeds available stock" and publishes a certificate of that proof next to the
endpoint. Your team reviews that theorem once, in Lean, and pins its
fingerprint with `zklean requirements`. Your client then rechecks the
certificate on a schedule:

- **They add a guarantee:** the check still passes.
- **They drop or change one you rely on:** the check fails, so your code can
  block the request, switch provider or alert someone before a bad order goes
  through.

Any change to the function, even a refactor, fails your check until your team
reviews it.

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

## How it works

1. The API author proves the guarantees once per release with
   [ZKLean](https://github.com/ZeframLou/zklean), in about 5 to 15 minutes for a
   small model. The result is a certificate under 1 KB.
2. The server answers an HTTP `OPTIONS` request to the endpoint's own URL with
   that certificate.
3. The client verifies the certificate without Lean and checks that it proves
   every requirement.

## Concepts

- **Certificate:** a small file that lists proved theorems, called **claims**,
  with a cryptographic receipt that ZKLean's Lean checker accepted the proofs.
- **Identity:** a fingerprint of a claim and the code it is about. Change
  either and the identity changes; re-proving the same thing doesn't.
- **Requirements:** the claims your code relies on, with their identities.
- **Axioms:** statements a proof assumes without proving. A false axiom can
  prove anything, so your client accepts only the ones it lists, normally
  Lean's three standard axioms (`standardAxioms`).

## Get started

HTTPV runs on [Bun](https://bun.sh/) 1.4.4 or newer. Install it with ZKLean:

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

The [usage guide](docs/USAGE.md) walks both teams through it: writing the Lean
model, generating `requirements.json`, and rechecking on a schedule. The
[specification](SPEC.md) defines the wire format for other implementations.

## Trust model

Clients verify each certificate themselves, trusting only ZKLean's checker and
its cryptography, their own requirements, and the axioms they accept. A pass
means the API's Lean model has every property the client requires; the client
trusts the server to run code that behaves as that model does. HTTPV does not
detect a server that misbehaves behind an unchanged certificate, or a change
between two checks.

## License

[MIT NON-AI License](LICENSE).
