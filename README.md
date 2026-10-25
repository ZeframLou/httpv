# HTTPV

HTTPV (HTTP Verified) lets an API publish a proof of how each endpoint
behaves, and lets clients check that proof before they rely on the endpoint.
When an API changes behavior your code depends on, your client finds out on
its next check and can stop calling it, instead of failing in production.

## Why

API documentation and changelogs are promises that code cannot check. Suppose
an inventory service's `POST /reservations` only ever reserves stock it has.
Your checkout is built on that. Then the service starts accepting backorders.
Nothing in your code changed and every request still succeeds, but you are now
selling stock that does not exist.

With HTTPV, the service's guarantee ("a reservation never exceeds available
stock") is a theorem with a proof, published next to the endpoint. Your client
states which guarantees it relies on. Before calling the endpoint, it checks the
current proof:

- An upgrade that keeps your guarantees and adds new ones passes.
- A change that drops or alters a guarantee you rely on fails, and your client
  blocks the dependent requests, switches provider, or alerts someone.

Ordinary requests and responses are unchanged.

## How it works

```text
 API author                        API server                      Client
 ──────────                        ──────────                      ──────
 Lean code for the endpoint,       OPTIONS /reservations
 theorems about it, proofs    ──▶  returns the certificate   ──▶   1. verify the proof
        │                          (under 1 KB per endpoint)       2. compare its claims with
   zklean prove                                                       the claims you rely on
        ▼                                                          3. call, or block
   certificate
```

- **[Lean](https://lean-lang.org/)** is a language for writing programs and
  mathematical proofs about them. The API author describes the endpoint as a
  Lean function and proves theorems about it, such as "a reservation never
  exceeds available stock".
- **[ZKLean](https://github.com/ZeframLou/zklean-dist)** turns those proofs into
  a **certificate**: the names of the proved theorems, called **claims**, a
  fingerprint of each one, and a 260-byte cryptographic proof. The client
  verifies it in a fraction of a second, with no Lean installation and no
  access to the original proofs.
- A claim's **fingerprint** (its identity) is a hash of its statement and of
  everything the statement refers to, including the endpoint's function. If the
  API changes the function or weakens the theorem, the fingerprint changes.
- Your **requirements** are the claims your code relies on, with their
  fingerprints. A check passes only if the certificate proves every one of them.

## Trust model

Clients verify every proof themselves, but still trust the server to run code
that behaves as its certificate describes. HTTPV cannot detect a server that
misbehaves while publishing an unchanged certificate, and it cannot see changes
between two checks.

## Get started

The npm packages are not published yet; reviewers can
[install prepared tarballs](docs/DEVELOPMENT.md#check-unpublished-packages).
After publication:

```sh
npm install httpv
```

HTTPV runs on [Bun](https://bun.sh/) 1.4.4 or newer.

**Server:** serve each endpoint's certificate alongside your existing handler.

```ts
import { serve } from "httpv";

Bun.serve({
  ...serve({
    routes: { "POST /reservations": await Bun.file("reservations.json").json() },
    fetch: app, // your existing request handler
  }),
});
```

**Client:** name the endpoint and the claims you rely on, then check before
each dependent request.

```ts
import { createHTTPV } from "httpv";

const monitor = createHTTPV().watch(
  {
    url: "https://inventory.example.com/reservations",
    method: "POST",
    // The claims your code relies on, written by `zklean requirements`.
    requirements: "./requirements.json",
    // Unproved assumptions you accept. `{}` accepts none.
    axioms: {},
  },
  { interval: 60_000 },
);

await monitor.refresh();
monitor.requireVerified(); // throws unless the endpoint still proves your claims
await fetch("https://inventory.example.com/reservations", { method: "POST" });
```

[`examples/upgrades.ts`](examples/upgrades.ts) walks through a real upgrade:
version 2 adds a guarantee and passes; version 3 accepts backorders and is
blocked. The example's certificates are being regenerated for the current
certificate format, so `bun run example` fails until they are.

The [usage guide](docs/USAGE.md) covers writing requirements, accepting
axioms, and monitoring. The [protocol specification](SPEC.md) defines the wire
format for other implementations.
