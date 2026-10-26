# Using HTTPV

This guide is for two teams:

- **API teams** publish a certificate for each endpoint, so clients can check
  by machine that it still behaves as promised.
- **Client teams** check those certificates before relying on an endpoint, and
  stop sending dependent requests when a promise they rely on changes.

The [README](../README.md#concepts) defines the terms used here: Lean, ZKLean,
certificates, claims, identities, axioms and requirements.

## Install

Both teams install the packages as in the
[README](../README.md#get-started). For TypeScript checking, also add
`@types/bun` as a development dependency.

Writing certificates and requirements also needs the ZKLean command-line tool,
which checks Lean proofs and generates certificates from them. Install it as
ZKLean's guide describes in
[Set up](https://github.com/ZeframLou/zklean/blob/v0.1.0/docs/USAGE.md#set-up);
this guide writes it as `zklean`. Lean projects must select
`leanprover/lean4:v4.35.0` in their `lean-toolchain` file. Checking
certificates needs only the packages.

## For API teams

### Model the endpoint in Lean

Write the endpoint's behavior as a Lean function, and prove theorems about it
that clients can rely on. A reservation endpoint might be:

```lean
namespace Inventory

/-- POST /reservations: take `quantity` units from `stock`, or reject. -/
def reserve (stock quantity : Nat) : Option Nat :=
  if quantity ≤ stock then some (stock - quantity) else none

/-- An accepted reservation never exceeds the available stock. -/
theorem reservation_safe (stock quantity remaining : Nat)
    (accepted : reserve stock quantity = some remaining) : quantity ≤ stock := by
  unfold reserve at accepted
  split at accepted <;> simp_all

end Inventory
```

Your server's code must behave as this function does; HTTPV certifies the
function, not the code. [`examples/inventory`](../examples/inventory) is a
complete project with three versions of an endpoint.

### Generate the certificate

Prove the theorems into a certificate before deployment:

```sh
zklean prove --project . --module Inventory \
  --claims Inventory.reservation_safe --axioms propext \
  --source https://inventory.example.com/reservations.ndjson \
  --out certs/reservations.json
```

- `--claims` names the theorems the certificate proves.
- `--axioms` must list every axiom the proofs use, or `prove` refuses.
- `--source` is the URL where you will publish the **export**: a file of
  Lean's compiled form of the definitions behind the claims, from which anyone
  can recompute the claims' identities. `prove` writes it beside the
  certificate, as `certs/reservations.ndjson`.

The export also contains your proofs. To keep them private, write a module that
states each claim as an `axiom` instead, and publish its export; a claim stated
as an axiom has the same identity as the proved theorem:

```sh
zklean export --project . --module InventorySpec \
  --claims Inventory.reservation_safe --out certs/reservations.ndjson
```

Proving takes about 5 to 15 minutes and up to 20 GB of memory on a 12-core
machine, and the first proof downloads 6.2 GB of proving files. It needs the
prover setup in ZKLean's guide. A certificate is typically under 1 KB, whatever
the size of the proofs.

### Serve the certificate

Wrap your existing request handler, a function from `Request` to `Response`:

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

Clients fetch a certificate with **discovery**: an `OPTIONS` request to the
endpoint's URL that asks for `application/httpv+json`. `serve` answers those
and passes every other request to your handler, including `OPTIONS` for paths
without certificates and browser CORS preflight requests. Paths match exactly
and the query is ignored. `serve` throws at startup if a static certificate is
invalid.

Give each endpoint its own certificate, with claims about that endpoint only,
so changing one endpoint never affects clients of another.

To change a certificate without restarting, pass a function instead. It runs on
every discovery request:

```ts
"POST /reservations": () => Bun.file("./certs/reservations.json").json(),
```

If the function throws or returns an invalid certificate, discovery for that
path fails with `503`, so clients of every method on it get `unknown`
(`unavailable`).

## For client teams

### Write your requirements

Your requirements are the claims your code relies on, each with its identity,
in a JSON file:

```json
{
  "format": "zklean/requirements/1",
  "claims": { "Inventory.reservation_safe": "56b0…" }
}
```

1. Get the API's Lean project from its team, and review the theorems your code
   relies on. Make sure they are about the function the endpoint implements.
   To confirm the project is the one certified, export it with
   `zklean export` and check that export against the endpoint's certificate
   with `zklean fetch --certificate … --from FILE`.
2. Generate requirements from that project, naming those theorems:

   ```sh
   zklean requirements --project vendor/inventory --module Inventory \
     --claims Inventory.reservation_safe --out requirements.json
   ```

   This builds the project with Lake, Lean's build tool, which runs the
   project's build code, so review or sandbox third-party projects first.

3. Commit `requirements.json`.

Instead of the API's project, you can write your own module that states the
claims as `axiom`s about identical definitions: a claim's identity covers its
statement and definitions, not its proof. If your code needs a weaker property
than the API certifies, prove it from the API's claims in your own Lean code
and require the API's claims.

### Create a client

Save this as `httpv.ts`:

```ts
import { createHTTPV } from "httpv";

export const httpv = createHTTPV();
```

The client verifies certificates itself, with ZKLean's built-in verifier. That
verifier uses a **verifying key**: a public key, fixed in the ZKLean package,
that identifies ZKLean's proof checker. A certificate that verifies under it
was produced by that checker. The key never comes from the API being checked,
and the client needs no Lean installation or other native tools.

### Check an endpoint

Describe the endpoint once, then check it:

```ts
import { standardAxioms } from "httpv";
import { httpv } from "./httpv.ts";

const inventory = {
  url: "https://inventory.example.com/reservations",
  method: "POST",
  requirements: "./requirements.json", // relative to the working directory
  axioms: standardAxioms, // Lean's propext, Quot.sound and Classical.choice
};

const result = await httpv.check(inventory);
if (result.status !== "verified")
  throw new Error(
    `inventory requirements: ${result.status} (${result.reason})`,
  );
```

`check` fetches the endpoint's certificate, verifies it, and compares its
claims with your requirements. It never throws; it returns a status and a
reason:

| Status         | Meaning                                                               | Reason                 |
| -------------- | --------------------------------------------------------------------- | ---------------------- |
| `verified`     | The certificate is valid and proves every required claim.             | `exact-match`          |
| `incompatible` | The certificate is valid, but a required claim is missing or changed. | `requirements-not-met` |
| `unknown`      | Nothing could be established.                                         | See below              |

`unknown` reasons:

- **Discovery failed:**
  - `unavailable`: a network error, timeout or redirect; an error status other
    than 404, 405, 406 or 501; a URL that is not HTTPS; or an invalid URL or
    method.
  - `missing-certificate`: no certificate for this method, or a server that
    does not support HTTPV.
  - `invalid-advertisement`: a malformed discovery response.
- **The certificate failed:**
  - `invalid-certificate`: it is malformed or its proof does not verify.
  - `forbidden-axiom`: it uses an axiom you did not accept.
  - `axiom-mismatch`: it uses an accepted axiom's name with another identity.
  - `verifier-unavailable`: the verifier could not run.
- **Your configuration failed:** `invalid-requirements`, including requirements
  with no claims and a malformed `axioms`.

`axioms` lists the axioms you accept, by name and identity; `{}` accepts only
certificates that use none.

On `incompatible`, the API changed a claim you rely on or the function it is
about. Review the API's new Lean project; if your code still holds, regenerate
`requirements.json` from it and commit it.

A result that got as far as verifying also carries `statementId`, an identity
of everything the certificate proves. Compare it to notice a new certificate;
do not compare certificate bytes, which can change without the claims
changing.

### Recheck on a schedule

APIs change without telling their clients, so recheck on an interval and send
dependent requests only while the latest result is `verified`. This is
application code, not part of HTTPV:

```ts
let latest = await httpv.check(inventory);
(async () => {
  // One check at a time, so an older one can never overwrite a newer result.
  for (;;) {
    await Bun.sleep(60_000);
    latest = await httpv.check(inventory);
  }
})();

async function reserve(quantity: number) {
  if (latest.status !== "verified")
    throw new Error(`inventory requirements: ${latest.reason}`);
  return fetch(inventory.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quantity }),
  });
}
```

Discovery gives up after 10 seconds, but verification itself is not bounded;
wrap `check` in your own deadline if you need one. Decide how old a result may
be before you stop relying on it.

### Local development

HTTPS is required and redirects are rejected. For a server on this machine
(`localhost` or a loopback address), add `allowInsecureHttp: true` to the
endpoint description passed to `check`.

### Lower-level control

- `httpv.query(url, { method })` returns the endpoint's certificate, or throws
  a `DiscoveryError` with the reason.
- `httpv.compare(certificate, inventory)` runs the rest of the check.
- Discovery's `timeout`, in milliseconds, and an abort `signal` go in
  `query`'s options or `check`'s second argument. The timeout applies even
  with a signal.
- `createHTTPV({ fetch })` uses another transport, which must not follow
  redirects or relax TLS.
- `createHTTPV({ backend })` uses another verifier. A backend has an `identity`
  string, a label for its trusted configuration unrelated to claim identities,
  and an async `verify(certificate)` returning a boolean. It is trusted to
  decide whether the proof establishes the certificate's claims and axioms.
