# HTTPV — HTTP Verified

**Protocol specification**

## 1. Purpose

HTTPV lets clients discover the formal guarantees advertised by API endpoints,
verify their certificates, and check whether updated guarantees still establish
the assumptions used by the client. It supports independently maintained
components whose advertised contracts can change over time.

Certificate generation is separate. This profile uses
[ZKLean certificates](https://github.com/ZeframLou/zklean-dist/blob/main/SPEC.md)
through a client-configured verifier; HTTPV does not invoke a prover or the
ZKLean CLI during discovery, verification, or monitoring.

### 1.1. Security model


ZKLean cryptographically attests that specified Lean propositions have valid derivations under explicitly declared axioms, subject to the soundness of the trusted proof checker and cryptographic proving system.

HTTPV authenticates, through HTTPS, the certificates currently advertised by a remote endpoint.

Clients trust remote providers to implement and deploy the behavior described by their advertised formal specifications. HTTPV does not independently attest to deployed code or prove that individual responses satisfy those specifications.

A client's formal guarantees remain **conditional on its remote dependencies satisfying the specifications on which the client relies**.

Clients MUST independently validate certificates and enforce their own acceptable-axiom policies.

## 2. Conventions


The terms MUST, MUST NOT, SHOULD, and MAY are interpreted according to RFC 2119 and RFC 8174.

A *specification* is a proposition expressed in Lean 4.

A *certificate* contains a public formal model, explicit axioms, and a succinct cryptographic proof of the specified propositions.

A *remote contract* is the formal model a server advertises for an HTTP endpoint.

A *client requirement* is a proposition about remote behavior that a client's own formal correctness proof assumes.

## 3. Protocol


### 3.1. Overview

HTTPV allows clients to retrieve the formal contracts currently advertised by HTTP endpoints.

The primary use case is a formally verified client that relies on remote components whose behavior may evolve independently.

The client proves its own properties under explicit assumptions about remote endpoints. HTTPV provides a mechanism to retrieve and continuously validate the advertised remote guarantees against those assumptions.

HTTPV uses the existing HTTP `OPTIONS` method and requires no changes to ordinary application requests or responses.

### 3.2. Certificate Discovery

A client requests endpoint certificates using:

```http
OPTIONS /reservations HTTP/1.1
Host: example.com
Accept: application/httpv+json
Cache-Control: no-cache
```

A supporting server responds:

```http
HTTP/1.1 200 OK
Content-Type: application/httpv+json
Cache-Control: no-store

{
  "certificates": {
    "POST": {
      "format": "zklean/1",
      "specs": {
        "declarations": "base64:...",
        "claims": ["Inventory.reservation_safe"]
      },
      "axioms": ["propext"],
      "proof": "base64:..."
    }
  }
}
```

The `certificates` object maps HTTP methods to their respective ZKLean certificates.

The advertised contract MUST define the behavior of the corresponding HTTP method and resource. This association MUST be authenticated as part of the HTTPV response, and the formal model MUST precisely identify the operations and inputs it describes.

Parameterized routes MAY share a certificate when its model explicitly covers the applicable parameter domain.

The server MUST return the formal contracts it currently advertises for the requested resource.

### 3.3. Compositional Verification

A verified client may depend on guarantees supplied by remote components.

Let:

- \(C\): Client implementation.
- \(S_C\): Desired client correctness specification.
- \(R_i\): Client requirement for remote dependency \(i\).
- \(G_i\): Formally certified guarantees advertised by remote dependency \(i\).

The client's proof establishes:

\[
(R_1 \land \cdots \land R_n)
\implies S_C(C)
\]

For this proof to remain applicable, each remote dependency must advertise guarantees sufficient to establish the corresponding requirement:

\[
G_i \implies R_i
\]

HTTPV MUST support checking this compatibility relationship.

A compatibility check may succeed through an exact match of certified propositions or a separately verified Lean derivation establishing that the advertised guarantees imply the required propositions.

The client's requirement and the remote formal model MUST be interpreted using compatible, explicitly resolved definitions. Identical proposition names alone are insufficient.

Exact matching compares each requested claim and its complete resolved kernel
context. Bound-variable display names and binder annotations MAY differ; constant
names, types, and definition bodies MUST agree. Extra certified remote claims
are permitted. This structural comparison does not decide arbitrary semantic
equivalence. Under explicit exact mode, a mismatch is `incompatible`; implication
mode MUST return `unknown` without an applicable verified bridge.

A bridge MUST independently certify the required propositions. Its axioms MUST
be permitted client axioms or independently authenticated remote claims. Remote
assumption permissions MUST bind the entire proposition and dependency context,
not only the theorem's name. All shared definitions MUST agree; differently
defined versions of an operation need distinct names in the bridge context.

**An arbitrary semantic implication MUST NOT be assumed merely because two certificates are valid.** If compatibility cannot be established, the dependency is unverified with respect to the client's requirements.

When a remote certificate changes, the client MAY:

1. Reuse its existing client proof if the new remote guarantees still establish its requirements.
2. Re-run formal verification of the client against the updated remote model.
3. Declare the dependency incompatible and apply application-defined handling.

The client MUST NOT treat a remote model as compatible solely because its ZKLean certificate verifies successfully.

### 3.4. Continuous Verification

Remote HTTP APIs may change their behavior and advertised formal models without notifying clients.

HTTPV clients SHOULD periodically retrieve the current certificates of their remote dependencies.

Each client controls:

- **Refresh interval:** How frequently remote certificates are checked.
- **Required guarantees:** Which propositions must continue to hold.
- **Axiom policy:** Which trusted axioms are acceptable.
- **Failure policy:** What happens when compatibility cannot be established.

The verification process is:

```text
      Client formal proof
              |
      Remote requirements
              |
              v
    Fetch remote certificate
              |
      Verify ZKLean proof
              |
    Check G_remote => R_client
              |
         +----+----+
         |         |
     Compatible  Incompatible
         |         |
    Continue    Client policy
         |
     Recheck later
```

Clients SHOULD compare cryptographic identities of canonical public models before performing more expensive compatibility checks.

If the model is unchanged and the previous compatibility result remains valid under the current policy, the client MAY reuse that result.

When a model changes, the client MUST re-establish compatibility before treating the updated model as satisfying its requirements.

Possible client policies include rejecting requests, disabling dependent functionality, using a fallback provider, notifying an operator, or initiating re-verification.

HTTPV does not mandate any particular policy.

### 3.5. Freshness and Failure Semantics

HTTPV discovery responses MUST describe the server's currently advertised formal contract.

Servers SHOULD return `Cache-Control: no-store`. Clients requiring fresh advertisements MUST avoid reliance on stale cached discovery responses.

Clients MAY cache certificates and previously verified compatibility results by cryptographic identity.

A failed HTTPV check has one of three outcomes:

- **Verified:** The current advertised contract is valid and satisfies the client's requirements.
- **Incompatible:** The advertised contract is valid but does not establish the client's requirements.
- **Unknown:** The certificate is missing, inaccessible, invalid, or compatibility cannot be determined.

Applications decide how to handle each outcome.

An implementation's monitor MUST bound the entire discovery and compatibility
cycle, including an asynchronous verifier, by its configured timeout. It MUST
expire a successful result after `maxAge`, even if a subsequent check stalls;
the TypeScript default is `interval + timeout`. A timed-out cycle MUST NOT
publish a late success. Implementations MAY leave non-cancellable backend work
running, but MUST bound concurrent backend work and pending requests.

`stop()` MUST invalidate monitored verification and prevent further polling.
`requireVerified()` MUST reject unchecked, expired, stopped, incompatible, and
unknown states. Applications requiring request gating MUST call it at the point
where a request depends on the monitored guarantee. A notification callback is
not a request gate.

Periodic checking cannot guarantee that an advertised contract will remain unchanged between checks. HTTPV also cannot detect a provider changing its actual behavior while continuing to advertise the same certificate. Clients requiring stronger guarantees need separate execution attestation or response-proof mechanisms.

## 4. TypeScript/Bun Implementation

The project MUST provide a TypeScript library targeting Bun, with client and server integration APIs.

### 4.1. Client API

**Query a certificate:**

```typescript
import { createHTTPV } from "httpv";

const HTTPV = createHTTPV();
const certificate = await HTTPV.query(
  "https://example.com/reservations",
  { method: "POST" }
);

const result = await HTTPV.verify(certificate, {
  allowedAxioms: ["propext", "Quot.sound"]
});
```

**Check compatibility:**

```typescript
const result = await HTTPV.checkCompatibility({
  certificate,
  requirements: "./specs/requirements.json",
  mode: "exact",
  allowedAxioms: ["propext", "Quot.sound"]
});
```

The compatibility API MUST authenticate the remote certificate and establish
the local requirements through exact context matching or an independently
verified bridge. It MUST NOT accept an unsupported implication.

A `.lean` requirement path MUST load `<path>.zklean.json`, generated beforehand
by `zklean requirements`. Its `zklean/source-manifest/1` MUST bind the primary
source, transitive source imports, Lake project files, and toolchain artifacts.
Every recorded file digest MUST match before the snapshot is used. Missing or
stale sidecars MUST yield `unknown` with reason `requirements-unavailable`;
the runtime MUST NOT generate sidecars or invoke Lean. A self-contained JSON
snapshot can be deployed without those source files.

**Monitor a dependency:**

```typescript
const monitor = HTTPV.watch({
  url: "https://example.com/reservations",
  method: "POST",
  requirements: "./specs/requirements.json",
  mode: "exact",
  allowedAxioms: ["propext"],
  interval: 60_000,
  timeout: 10_000,
  maxAge: 70_000,

  onChange: (result) => { console.log(result.status, result.reason); }
});

await monitor.refresh();
monitor.requireVerified();
await fetch("https://example.com/reservations", { method: "POST" });
```

`watch` periodically refreshes the remote contract, verifies its certificate, and evaluates compatibility.

The callback receives the current verification status, reason, certificate
identity, model identity, and check time. It MUST be synchronous; returning a
promise invalidates verification and stops the monitor. It runs on the first
result and meaningful state or identity changes. Discovery failures become
`unknown` results; `onError` handles callback errors. Concurrent refreshes share
one check, and `current` returns a snapshot rather than mutable internal state.

### 4.2. Server API

```typescript
import { HTTPV } from "httpv";

const app = HTTPV.serve({
  routes: {
    "POST /reservations": "./certs/reservations.json"
  },
  fetch: existingHandler
});
```

The server adapter automatically handles HTTPV discovery requests and delegates normal HTTP requests to the existing application handler.

Certificates are generated separately, typically during development or CI, and published alongside the application.

### 4.3. Implementation Requirements

The library SHOULD:

- Support Bun's native HTTP server and Fetch APIs.
- Support existing HTTP applications through lightweight adapters.
- Share certificate verification and serialization logic.
- Support configurable polling intervals and client-defined failure handling.
- Cache verified certificates and compatibility results by cryptographic identity.
- Distinguish invalid certificates, incompatible specifications, and unavailable dependencies.
- Pin trusted SP1 verifier identities and enforce explicit axiom policies.

The client library MUST NOT silently classify an unknown compatibility result as verified.

## 5. Non-goals


ZKLean and HTTPV do not provide:

- Hardware or remote code execution attestation.
- Per-request cryptographic execution proofs.
- Guaranteed detection of deployment changes not reflected in advertised contracts.
- Automatic generation of meaningful formal specifications.
- Automatic proofs of arbitrary implications between specifications.
- Proofs of the truth of external axioms.
- Guarantees that specifications fully capture intended behavior.
- Strict real-time detection of dependency changes.
- Changes to ordinary HTTP request/response semantics.

## 6. Implementation boundary

The TypeScript package depends only on ZKLean's public certificate, model,
snapshot, and verifier APIs. It has no Rust build or SP1 toolchain requirement.
The default HTTPV instance uses ZKLean's embedded WebAssembly Groth16 verifier
and pinned checker key. Clients MAY configure another trusted backend using
`createHTTPV({backend})`; it MUST implement ZKLean's `ProofBackend` interface and
authenticate the complete statement under an application-selected checker
identity. Discovery MUST NOT select the backend or its keys. Client verification
requires no native installation, Lean process, or proving data.

See [ZKLean's encoding profile](https://github.com/ZeframLou/zklean-dist/blob/main/docs/ENCODING.md)
for certificate serialization and verifier pinning, and [Encoding](docs/ENCODING.md)
for HTTPV's compatibility rules.
