# HTTPV

HTTPV (HTTP Verified) is an HTTP protocol and TypeScript library for checking
whether an API's advertised guarantees meet a client's requirements as the API
evolves.

Even a mathematically verified client depends on assumptions about external
services. Those services evolve independently: a supplier that once reserved
only available stock may introduce backorders, invalidating the client's
assumptions without any client code changing.

HTTPV lets clients recheck those assumptions against the guarantees an API
currently advertises. Compatible updates let the client keep its existing
correctness argument; otherwise, it can block dependent requests, switch
providers, or revise its assumptions.

## How it works

An API's guarantees are expressed as mathematical statements in
[Lean](https://lean-lang.org/). [ZKLean](https://github.com/ZeframLou/zklean-dist)
produces a certificate: cryptographic evidence that those statements follow from
declared assumptions, called axioms.

The server publishes its certificate through HTTP `OPTIONS`. The client verifies
it, checks compatibility with its own requirements, and polls for changes.
Certificate generation happens separately from serving and checking requests.

## Trust model

Clients independently verify advertised guarantees but still trust the server
to implement them in its deployed code and responses. HTTPV cannot detect a
server violating its specification while advertising an unchanged certificate,
and polling can miss changes between checks. Each client chooses its own
verifier, requirements, permitted axioms, and failure policy.

## Get started

The npm packages are not published yet. Private reviewers can
[install prepared tarballs](docs/DEVELOPMENT.md#check-unpublished-packages).
After publication, install from npm:

```sh
npm install httpv
```

Run with [Bun](https://bun.sh/) 1.4.4 or newer. A client describes the
endpoint it depends on and gates requests on the latest check:

```ts
import { createHTTPV } from "httpv";
import { standardAxioms } from "zklean";

const monitor = createHTTPV().watch(
  {
    url: "https://inventory.example.com/reservations",
    method: "POST",
    operation: "Inventory.POST_reservations",
    requirements: "./specs/requirements.json",
    axioms: { propext: standardAxioms.propext },
  },
  { interval: 60_000 },
);

await monitor.refresh();
monitor.requireVerified(); // throws unless the current contract still holds
```

[`examples/upgrades.ts`](examples/upgrades.ts) runs the whole workflow with
real certificates: `bun run example`. The [usage guide](docs/USAGE.md) covers
serving certificates, choosing requirements, and monitoring.

[Protocol specification](SPEC.md) · [Development](docs/DEVELOPMENT.md)
