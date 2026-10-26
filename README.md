# HTTPV

HTTPV (HTTP Verified) is an HTTP protocol and TypeScript library for Bun that
lets your code notice, before it sends a request, that an API it depends on no
longer promises the behavior your code relies on. It is for teams whose code
depends on another team's API, and for API teams that want to make promises
clients can check by machine.

## Why

API documentation and changelogs are promises that code cannot check. Suppose
an inventory service's `POST /reservations` only ever reserves stock it has,
and your checkout is built on that. Then the service starts accepting
backorders. Your code is unchanged and every request still succeeds, but you
are now selling stock that does not exist.

With HTTPV, the service models the endpoint as a function, states its guarantee
("a reservation never exceeds available stock") as a mathematical statement
about that function, proves it, and publishes a certificate of that proof next
to the endpoint. Your client lists the guarantees it relies on and rechecks the
certificate on a schedule:

- If the service adds guarantees without changing the function your
  guarantees describe, the check passes.
- If it drops or changes a guarantee you rely on, or changes that function at
  all, the check fails, so your code can block dependent requests, switch
  provider, or alert someone. Even a harmless refactor fails until you review
  it.

Ordinary requests and responses are unchanged.

## Concepts

- **[Lean](https://lean-lang.org/)** is a programming language and proof
  assistant. The API author writes the endpoint's behavior as a Lean function
  and proves **theorems** about it, such as "a reservation never exceeds
  available stock". Proofs are checked mechanically.
- **[ZKLean](https://github.com/ZeframLou/zklean)** checks those proofs
  with an independent Lean proof checker, run inside a **proving system**: a
  program runner that also produces a short **cryptographic proof** that the
  program ran and what it returned. Anyone can check that proof in under a
  second, without the Lean proofs or a Lean installation. ZKLean packages it as
  a **certificate**, which lists the proved theorems, called **claims**.
- Each claim has an **identity**: a hash of its name, its statement, and
  everything the statement refers to, including the endpoint's function. If the
  API changes that function or the theorem's statement, the identity changes; a
  new proof of the same statement does not change it.
- **Axioms** are statements a proof assumes without proving. A false axiom can
  prove anything, so your client lists the ones it accepts, normally only
  Lean's standard three: `propext`, `Quot.sound` and `Classical.choice`.
- Your **requirements** are the claims your code relies on, with their
  identities. A check passes only if the certificate proves all of them.

## How it works

```text
 API author                     API server                       Client
 ──────────                     ──────────                       ──────
 Lean function + theorems       answers OPTIONS /reservations    1. verify the certificate
        │ zklean prove          with the certificate        ──▶  2. compare its claims with
        ▼                       for POST                            your requirements
    certificate          ──▶                                     3. call, or block
```

The API author proves once per release, offline: about 5 to 15 minutes for a
small model. The server answers an HTTP `OPTIONS` request to the endpoint's own
URL with the endpoint's certificate, typically under 1 KB, and also publishes
one file of the Lean definitions behind it.

## Trust model

Clients check each certificate's cryptographic proof themselves, trusting
ZKLean's checker and the cryptography behind its proofs, their own reviewed
requirements, and the axioms they accept. They still trust the server to run
code that behaves as its Lean function describes. HTTPV cannot detect a server
that misbehaves behind an unchanged certificate, or a change between two
checks.

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

**Client:** describe the endpoint and your requirements, and check before
relying on it. Generating `requirements.json` needs the ZKLean command-line tool
and the API's Lean project; the [usage guide](docs/USAGE.md) shows how.

```ts
import { createHTTPV, standardAxioms } from "httpv";

const result = await createHTTPV().check({
  url: "https://inventory.example.com/reservations",
  method: "POST",
  requirements: "./requirements.json", // generated by `zklean requirements`
  axioms: standardAxioms, // Lean's propext, Quot.sound and Classical.choice
});
if (result.status === "verified")
  await fetch("https://inventory.example.com/reservations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quantity: 1 }),
  });
```

[`examples/upgrades.ts`](examples/upgrades.ts) serves three versions of an
endpoint: version 2 adds a guarantee and should pass; version 3 accepts
backorders and should be blocked. Run it from a clone with `bun run example`
([setup](docs/DEVELOPMENT.md)).

The [usage guide](docs/USAGE.md) covers writing requirements, accepting
axioms, and rechecking on a schedule. The [protocol specification](SPEC.md)
defines the wire format for other implementations.

## License

[MIT NON-AI License](LICENSE).
