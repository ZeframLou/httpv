# Using HTTPV

This guide is for two teams:

- **API teams** publish a certificate for each endpoint, so clients can check
  by machine that it still behaves as promised.
- **Client teams** check those certificates before relying on an endpoint, and
  stop sending dependent requests when a promise they rely on changes.

The [README](../README.md) explains what HTTPV is for, and its
[Concepts](../README.md#concepts) define the terms used here: certificates,
claims, identities, requirements and axioms.

## Install

Both teams install the packages as in the
[README](../README.md#get-started). For TypeScript checking, also run
`bun add -d @types/bun`.

Writing certificates and requirements also needs the ZKLean command-line tool,
which checks Lean proofs and generates certificates from them. Install it as
ZKLean's guide describes in
[Set up](https://github.com/ZeframLou/zklean/blob/v0.1.0/docs/USAGE.md#set-up);
this guide writes it as `zklean`. Checking certificates needs only the
packages.

## For API teams

### Model the endpoint in Lean

Write the endpoint's behavior as a Lean function, and prove theorems about it
that clients can rely on. Create a project with Lake, Lean's build tool, and
set the Lean version in its `lean-toolchain` file to the one ZKLean requires:

```sh
lake new inventory lib
cd inventory
echo leanprover/lean4:v4.35.0 > lean-toolchain
```

Replace the contents of `Inventory.lean` with the model and its theorems:

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
function, not the code. [Lean's documentation](https://lean-lang.org/learn/)
teaches writing proofs. [`examples/inventory`](../examples/inventory) is a
complete project, under other names, with three versions of an endpoint.

### Generate the certificate

First check the proofs, which takes seconds:

```sh
zklean check --project . --module Inventory \
  --claims Inventory.reservation_safe --axioms propext
```

`--axioms` names the axioms the proofs may use; `check` fails, naming the
axiom, if they use another.

Proving takes about 5 to 15 minutes and up to 20 GB of memory on a 12-core
machine. The first proof downloads 6.2 GB of proving files. You need ZKLean's
prover build and `ZKLEAN_GUEST_ELF`, the path to its checker program; ZKLean's
[Set up](https://github.com/ZeframLou/zklean/blob/v0.1.0/docs/USAGE.md#set-up)
covers both, and needs Go 1.24, `protoc` and a C compiler. Then prove the
theorems into a certificate before deployment:

```sh
zklean prove --project . --module Inventory \
  --claims Inventory.reservation_safe --axioms propext \
  --source https://inventory.example.com/reservations.ndjson \
  --out certs/reservations.json
```

- `--claims` names the theorems the certificate proves.
- `--axioms` is as for `check`.
- `--source` is the URL where you will publish the **export**: a file of
  Lean's compiled form of the definitions behind the claims, from which anyone
  can recompute the claims' identities. `prove` writes it beside the
  certificate, as `certs/reservations.ndjson`; publish it at exactly that
  `https` URL, served directly with no redirect, for example as a static file.

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
malformed; it does not verify proofs.

Give each endpoint its own certificate, with claims about that endpoint only,
so changing one endpoint never affects clients of another.

To change a certificate without restarting, pass a function instead. It runs on
every discovery request:

```ts
"POST /reservations": () => Bun.file("./certs/reservations.json").json(),
```

If the function throws or returns an invalid certificate, discovery for that
path fails with `503`, so `check` returns status `unknown` with reason
`unavailable` for every method on that path (see
[Check an endpoint](#check-an-endpoint)).

## For client teams

### Write your requirements

Your requirements are the claims your code relies on, each with its identity,
in a JSON file:

```json
{
  "format": "zklean/requirements/1",
  "claims": { "Inventory.reservation_safe": "80f5…" }
}
```

1. Get the API's Lean project from its team into `vendor/inventory`, and review
   the theorems your code relies on. Make sure they are about the function the
   endpoint implements. To confirm the project is the one certified, save the
   endpoint's certificate and check the project's export against it. The
   `zklean` commands build the project with Lake, which runs its build code, so
   review or sandbox a third-party project first. Run this in your client
   project, where `httpv` is installed:

   ```sh
   bun -e 'import { createHTTPV } from "httpv";
   const certificate = await createHTTPV().query(
     "https://inventory.example.com/reservations", { method: "POST" });
   await Bun.write("cert.json", JSON.stringify(certificate));'
   zklean export --project vendor/inventory --module Inventory \
     --claims Inventory.reservation_safe --out api.ndjson
   zklean fetch --certificate cert.json \
     --axioms propext,Quot.sound,Classical.choice \
     --from api.ndjson --out checked.ndjson
   ```

   `fetch` fails, listing the mismatches, unless the project reproduces the
   identity of every claim and every non-standard axiom in the certificate.

2. Generate requirements from that project, naming those theorems:

   ```sh
   zklean requirements --project vendor/inventory --module Inventory \
     --claims Inventory.reservation_safe --out requirements.json
   ```

   With `--export checked.ndjson` in place of `--project` and `--module`, the
   same command uses the export checked in step 1 instead of building the
   project.

3. Commit `requirements.json`.

You don't need the API's whole project. Your own module can restate the claims
as `axiom`s over the same definitions, because an identity covers the statement,
not the proof. If your code needs a weaker property
than the API certifies, prove it from the API's claims in your own Lean code
and require the API's claims.

### Create a client

Save this as `httpv.ts`:

```ts
import { createHTTPV } from "httpv";

export const httpv = createHTTPV();
```

The client checks certificates itself, with a **verifier key** built into the
ZKLean package: a fingerprint of ZKLean's checker, never one sent by the API.
It needs no Lean or native tools.

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

`axioms` lists the axioms you accept, by name and identity; `{}` accepts only
certificates that use none.

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
  - `invalid-certificate`: its proof does not verify, or a certificate passed
    to `compare` is malformed.
  - `forbidden-axiom`: it uses an axiom you did not accept.
  - `axiom-mismatch`: it uses an accepted axiom's name with another identity.
  - `verifier-unavailable`: the verifier could not run.
- **Your configuration failed:** `invalid-requirements`: the requirements file
  is missing, malformed or has no claims, or `axioms` is malformed.

On `incompatible`, the API changed a claim you rely on or the function it is
about. Review the API's new Lean project; if your code still holds, regenerate
`requirements.json` from it and commit it.

`verified` and `incompatible` results also carry `statementId`, ZKLean's
**statement digest**: a hash of everything the certificate proves. Compare it
with your last result's to notice that what the API certifies has changed; do
not compare certificate bytes, which can change without the claims changing.

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

Discovery times out after 10 seconds. Verification has no timeout; add your own
if you need one. Decide how old a result may
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
- `createHTTPV({ backend })` uses another verifier. A backend has a label for
  its trusted configuration, `identity` (unrelated to claim identities), and an
  async `verify(certificate)` returning a boolean. It is trusted to decide
  whether the proof establishes the certificate's claims and axioms.
