# Using HTTPV

The [README](../README.md) explains the concepts: certificates, claims,
identities, axioms, and requirements.

## Install

Install as in the [README](../README.md#get-started). For TypeScript checking,
add `@types/bun` as a development dependency.

Generating certificates and requirements needs the
[ZKLean CLI](https://github.com/ZeframLou/zklean), run from a ZKLean checkout
as `bun src/cli.ts` with its native checker and `lean4export` built (ZKLean's
`CONTRIBUTING.md`); this guide writes it as `zklean`. Lean projects must select
`leanprover/lean4:v4.36.0-rc1` in `lean-toolchain`. Checking certificates needs
only the npm packages.

## Serve a certificate

Generate each endpoint's certificate with `zklean prove` before deployment:

```sh
zklean prove --project . --module Inventory \
  --claims Inventory.reservation_safe --axioms propext \
  --source https://inventory.example.com/reservations.ndjson \
  --timeout 86400000 --out certs/reservations.json
```

`--axioms` must list every axiom the proofs use, or `prove` refuses.
`--timeout` is in milliseconds; the default is one hour. Proving runs offline,
takes tens of minutes to hours and several GB of memory, and needs ZKLean's
proving setup (its `CONTRIBUTING.md`).

A certificate is typically under 1 KB; its size grows with the number of claims
and axioms, not with the size of the proofs. It holds:

- **claims:** the proved theorems, each with its identity;
- **axioms:** the unproved assumptions the proofs use, with their identities;
- **proof:** the cryptographic proof of the claims under those axioms;
- **source:** the URL where you publish the **Lean export**, a file of the
  compiled Lean declarations the identities are computed from. `zklean prove`
  writes it (`certs/reservations.ndjson`) beside the certificate; pass its URL
  with `--source`. To keep proofs private, publish at that URL an export of a
  module that states the claims as axioms instead; identities do not cover
  proofs, so they are the same.

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

HTTPV answers **discovery**: `OPTIONS` requests that ask for
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

If the function throws or returns an invalid certificate, the server answers
`503`, and clients report `unknown / unavailable`.

## Create a client

Save this as `httpv.ts`:

```ts
import { createHTTPV } from "httpv";

export const httpv = createHTTPV();
```

The client verifies certificates with ZKLean's embedded WebAssembly verifier and
its **verifying key**, the public key that identifies ZKLean's checker program.
The key is pinned in the SDK, never taken from the API being checked. The
client needs no native executable, prover, or Lean process.

To use another transport, pass `createHTTPV({ fetch })`; it must not follow
redirects or relax TLS. To use another verifier, pass `createHTTPV({ backend })`. A backend has an
`identity` string describing its trusted configuration and an async
`verify(certificate)` returning a boolean. It is trusted to decide whether the
proof establishes the certificate's claims and axioms.

## Write your requirements

Your requirements are a JSON file of claims and identities:

```json
{
  "format": "zklean/requirements/1",
  "claims": { "Inventory.reservation_safe": "56b0…" }
}
```

1. Get the API's Lean source and review the theorems your code relies on.
2. Generate requirements from that source, naming those theorems:

   ```sh
   zklean requirements --project vendor/inventory --module Inventory \
     --claims Inventory.reservation_safe --out requirements.json
   ```

   `--project` builds that source with Lake, which runs its build code, so
   review or sandbox third-party source first. You can also state the claims
   yourself, as `axiom`s in your own module: an identity covers a statement,
   not its proof, so an axiom matches a theorem with the same statement.

3. Commit `requirements.json`.

Make sure the claims are about the function the endpoint implements; their
identities then fix that function's definition. If your code needs a weaker
property than the API certifies, prove it from the API's claims in your own
Lean code and require the API's claims.

## Check an endpoint

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

`check` fetches the endpoint's certificate, verifies it, and compares its claim
identities with your requirements. It never throws. A result that got as far as
verifying carries `statementId`, which changes whenever the certified claims or
axioms do.

| Status         | Meaning                                                               | Reason                 |
| -------------- | --------------------------------------------------------------------- | ---------------------- |
| `verified`     | The certificate is valid and proves every required claim.             | `exact-match`          |
| `incompatible` | The certificate is valid, but a required claim is missing or changed. | `requirements-not-met` |
| `unknown`      | Nothing could be established.                                         | See below              |

`unknown` reasons:

- discovery: `unavailable` (network error, timeout, server error, redirect, a
  URL that is not HTTPS, or an invalid URL or method), `missing-certificate`
  (no certificate for this method, or a server that does not support HTTPV),
  and `invalid-advertisement` (a malformed discovery response);
- the certificate: `invalid-certificate`, `forbidden-axiom`, `axiom-mismatch`,
  and `verifier-unavailable`;
- your configuration: `invalid-requirements`, including requirements with no
  claims.

`axioms` lists the axioms you accept, by name and identity. `{}` accepts only
certificates that use none. A certificate using an axiom you did not list is
`unknown / forbidden-axiom`, and one whose axiom has a different identity is
`unknown / axiom-mismatch`.

For lower-level control, `httpv.query(url, { method })` returns the endpoint's
certificate, throwing a `DiscoveryError` if discovery fails, and
`httpv.compare(certificate, inventory)` runs the rest of the check. Discovery
gives up after `timeout` milliseconds, 10 s by default, even if you also pass a
`signal`; pass either in `query`'s options or as `check`'s second argument.

## Recheck on a schedule

APIs change without telling their clients, so recheck on an interval and gate
dependent requests on the latest result. This is application code, not part of
HTTPV:

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
    body: JSON.stringify({ quantity }),
  });
}
```

A check returns within `timeout` for discovery, but verification itself is not
bounded; wrap `check` in your own deadline if you need one. Decide how old a
result may be before you stop relying on it.

## Local development

HTTPS is required and redirects are rejected. For a server on this machine
(`localhost` or a loopback address), add `allowInsecureHttp: true` to the
endpoint description passed to `check`.
