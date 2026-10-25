# HTTPV — HTTP Verified

**Protocol specification, version `httpv/1`**

## 1. Purpose

A formally verified client proves its own correctness under assumptions about
the remote APIs it calls. Those APIs change independently. HTTPV lets an API
advertise certified guarantees for its endpoints, and lets a client check that
the current guarantees still establish its assumptions.

Certificates use the [ZKLean format](https://github.com/ZeframLou/zklean-dist/blob/main/SPEC.md).
Generating them is out of scope; HTTPV only discovers and checks them.

The key words MUST, MUST NOT, SHOULD, and MAY follow RFC 2119 and RFC 8174.

## 2. Terms

- **Specification:** a proposition in Lean 4.
- **Identity:** ZKLean's hash of a Lean declaration and everything it refers
  to, binding every constant name and its content. A proposition's identity
  covers its statement, not its proof.
- **Certificate:** the identities of the claims it proves and of the axioms
  the proofs use, plus a succinct proof and an unproved pointer to their Lean
  source.
- **Operation:** the Lean function that defines an endpoint's behavior.
- **Advertisement:** an operation name and a certificate for one HTTP method of
  one resource.
- **Requirements:** the claims, by name and identity, that a client's proof
  assumes about an operation.

## 3. Trust model

ZKLean attests that the certified propositions have valid derivations under the
declared axioms, assuming its proof checker and proof system are sound. HTTPS
authenticates which advertisement a server currently publishes for a resource.

Clients still trust the server to deploy behavior matching its advertisement.
HTTPV does not attest deployed code, prove individual responses, or detect a
change in behavior under an unchanged advertisement. A client's guarantees
remain conditional on its dependencies meeting the specifications it relies on.

## 4. Discovery

A client requests advertisements with `OPTIONS`:

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
Vary: Accept

{
  "format": "httpv/1",
  "contracts": {
    "POST": {
      "operation": "Inventory.POST_reservations",
      "certificate": {
        "format": "zklean/1",
        "claims": { "Inventory.reservation_safe": "56b0…" },
        "axioms": { "propext": "b75a…" },
        "source": "https://example.com/inventory.ndjson",
        "proof": "base64:..."
      }
    }
  }
}
```

The envelope and each advertisement are closed objects: they MUST contain
exactly the fields shown, and clients MUST reject anything else. Extensions
require a new `format`. `contracts` maps HTTP methods to advertisements.

`source` is the URL of a Lean export containing every named declaration. It is
not part of the proved statement. Clients MUST NOT rely on it except to obtain
Lean declarations, and MUST discard any that do not reproduce the certified
identities.

`operation` MUST be nonempty. It states which function in the certificate's
claims the endpoint implements, so one certificate MAY serve several endpoints.
The server MUST describe the behavior of that method and resource with that
operation, and the operation MUST state the inputs it covers. Parameterized
routes MAY share an operation when it covers the whole parameter domain.

The response MUST reflect what the server currently advertises. Servers SHOULD
send `Cache-Control: no-store`. A resource without advertisements returns 404.
Requests without the HTTPV media type are ordinary HTTP requests.

Clients MUST use HTTPS outside local development and MUST NOT follow redirects.

## 5. Compatibility

The client's proof establishes `(R₁ ∧ … ∧ Rₙ) ⟹ S`, where `S` is its
correctness specification and `Rᵢ` are the claims it assumes about dependency
`i`. The proof stays applicable while each dependency certifies every `Rᵢ`. A
valid certificate alone MUST NOT be treated as establishing this.

A client checks an advertisement against its requirements and expected
operation:

1. **Certificate.** Verify the certificate with a client-selected verifier and
   reject axioms outside the client's policy. Discovery MUST NOT select the
   verifier or its keys.
2. **Operation.** The advertised operation MUST equal the expected one.
3. **Claims.** Every required claim MUST be certified with the same identity.
   Extra remote claims are permitted.

Comparison is identity equality. It is sound because an identity binds the
names and content of everything a statement refers to, including the
operation's body: equal identities mean the same statement about the same
function. The client MUST ensure its requirements are about the operation it
expects. If its proof needs a weaker property, it proves that from the remote
claims itself and requires those claims; HTTPV does not search for
implications. Names must stay stable: a renamed or redefined operation needs
new, reviewed requirements.

## 6. Results

A check has one of three outcomes. Applications choose how to handle each.

- **`verified`:** the certificate is valid and certifies every required claim.
- **`incompatible`:** the certificate is valid, but the operation differs or a
  required claim is missing or different.
- **`unknown`:** discovery failed, the certificate is invalid, the
  requirements are unusable, or the check did not finish.

Implementations MUST NOT report `unknown` as `verified`.

## 7. Monitoring

Clients SHOULD recheck dependencies periodically and MUST re-establish
compatibility whenever the advertisement changes. Each client chooses its
interval, requirements, axiom policy, and failure policy.

A monitor MUST bound each check, including verification, by a timeout, and MUST
discard a result that arrives after it. A verified result MUST stop gating
requests after a maximum age, even while the next check is running. Gating MUST
happen where a request depends on the guarantee, and MUST reject unchecked,
expired, stopped, incompatible, and unknown states; a change notification is
not a gate.

Periodic checking cannot show what a server does between checks. Stronger
guarantees need execution attestation or per-response proofs.

## 8. Non-goals

HTTPV does not provide hardware or code attestation, per-request proofs,
detection of behavior changes under an unchanged advertisement, automatic
specifications or implication proofs, proofs that external axioms are true, or
any change to ordinary HTTP semantics.
