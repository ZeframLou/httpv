# HTTP Verified (HTTPV)

**Version `httpv/1`** · Draft · Work in progress; the format may change.

## Abstract

HTTPV lets an HTTP origin server publish, for each endpoint, a succinct
certificate that proves theorems about the endpoint's behavior, and lets a
client check that certificate against the theorems its own correctness depends
on. Clients discover certificates with an `OPTIONS` request, verify them
locally, and stop relying on an endpoint whose certified behavior no longer
meets their requirements. Ordinary requests and responses are unchanged.

## Table of contents

1. [Introduction](#1-introduction)
2. [Overview](#2-overview)
3. [Certificates and requirements](#3-certificates-and-requirements)
4. [Discovery](#4-discovery)
5. [Checking an endpoint](#5-checking-an-endpoint)
6. [Monitoring](#6-monitoring)
7. [Security considerations](#7-security-considerations)
8. [Privacy considerations](#8-privacy-considerations)
9. [IANA considerations](#9-iana-considerations)
10. [References](#10-references)

Appendix A. [Example](#appendix-a-example)

## 1. Introduction

A client that depends on a remote API relies on assumptions about the API's
behavior. The API evolves independently, so an assumption can stop holding
without any change to the client. A client whose own correctness has been
proved formally is affected most: its proof is conditional on those
assumptions, and nothing tells it when one breaks.

HTTPV makes those assumptions checkable. The API author states the endpoint's
behavior as a function in the Lean theorem prover [LEAN], proves theorems about
it, and converts the proofs into a certificate with ZKLean [ZKLEAN]. The
certificate names each proved theorem with an identity that fixes its exact
meaning. A client records the identities its proof depends on and accepts the
endpoint only while its current certificate proves all of them.

### 1.1. Requirements language

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD",
"SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this
document are to be interpreted as described in BCP 14 [RFC2119] [RFC8174] when,
and only when, they appear in all capitals, as shown here.

### 1.2. Terminology

This document uses the terms "resource", "target resource", "method",
"origin server", "user agent", and "representation" as defined in HTTP
Semantics [RFC9110], and "JSON text" as defined in [RFC8259].

- **Endpoint:** one method of one target resource, such as
  `POST /reservations`.
- **Operation:** the Lean function that defines an endpoint's behavior.
- **Claim:** a proposition proved about one or more operations, named by its
  fully qualified Lean name.
- **Axiom:** a proposition assumed without proof. Lean's standard axioms are
  `propext`, `Quot.sound`, and `Classical.choice`.
- **Identity:** a 64-character lowercase hexadecimal SHA-256 digest that ZKLean
  computes for a declaration. It covers the declaration's name and statement
  and, transitively, the name and content of every declaration the statement
  refers to, including operation bodies. It does not cover proofs.
- **Certificate:** a ZKLean certificate (Section 3.1).
- **Requirements:** the claims, by name and identity, that a client's
  correctness depends on for one endpoint (Section 3.2).
- **Axiom policy:** the axioms, by name and identity, that a client accepts.

## 2. Overview

```text
 Client                                           Origin server
   │  OPTIONS /reservations                            │
   │  Accept: application/httpv+json                   │
   │ ────────────────────────────────────────────────▶ │
   │                                                   │
   │  200 OK                                           │
   │  Content-Type: application/httpv+json             │
   │  {"format":"httpv/1","certificates":{"POST":…}}   │
   │ ◀──────────────────────────────────────────────── │
   │                                                   │
   │  verify certificate, compare with requirements    │
   │                                                   │
   │  POST /reservations   (only if verified)          │
   │ ────────────────────────────────────────────────▶ │
```

1. The client asks the target resource for its certificates (Section 4).
2. It verifies the certificate for the method it will use, under its axiom
   policy, and checks that every required claim is certified with the same
   identity (Section 5).
3. It sends dependent requests only while the latest check succeeded and is
   recent enough (Section 6).

## 3. Certificates and requirements

### 3.1. Certificates

Certificates use the ZKLean format [ZKLEAN], which defines their encoding,
validation, and verification. A certificate is a JSON object with exactly these
members:

| Member   | Value                                                                 |
| -------- | --------------------------------------------------------------------- |
| `format` | The string `"zklean/1"`.                                              |
| `claims` | An object mapping each proved claim's name to its identity.          |
| `axioms` | An object mapping each axiom the proofs use to its identity.         |
| `proof`  | A succinct proof that `format`, `claims`, and `axioms` hold together. |
| `source` | An `https` or `file` URL of a Lean export containing the claims.     |

The proof covers `format`, `claims`, and `axioms`. It does not cover `source`,
which only tells a reader where to find the Lean declarations behind the
identities (Section 7.5).

Two claims with the same name and identity are the same statement about the
same operations. A claim stated as a Lean `axiom` has the same identity as a
theorem with the same statement, so requirements can be written without proofs.

### 3.2. Requirements

Requirements are a ZKLean requirements object [ZKLEAN]:

```json
{
  "format": "zklean/requirements/1",
  "claims": { "Inventory.reservation_safe": "56b0…" }
}
```

A client MUST derive its requirements from Lean declarations it has reviewed,
and MUST NOT copy them from the certificate it is about to check. The required
claims MUST be about the operation the client expects the endpoint to
implement; their identities then fix that operation's definition.

## 4. Discovery

### 4.1. Request

A client discovers an endpoint's certificate by sending `OPTIONS` to the
target resource in origin form, with an `Accept` header field that lists
`application/httpv+json` with a non-zero quality value:

```http
OPTIONS /reservations HTTP/1.1
Host: inventory.example
Accept: application/httpv+json
Cache-Control: no-cache
```

The client MUST use the `https` scheme, except for local development where the
user has explicitly allowed `http`. The target URI MUST NOT contain userinfo
or a fragment. The client SHOULD send `Cache-Control: no-cache` and MUST NOT
follow redirects.

An `OPTIONS` request is a discovery request only if all of the following hold;
otherwise the server MUST process it as an ordinary request:

- its `Accept` header field lists `application/httpv+json` with a quality value
  other than zero;
- it carries no `Access-Control-Request-Method` header field, which would make
  it a CORS preflight request [FETCH].

### 4.2. Response

If the target resource has certificates, the server responds with status
`200 (OK)` and a JSON text [RFC8259] encoded in UTF-8:

```json
{
  "format": "httpv/1",
  "certificates": {
    "POST": { "format": "zklean/1", "claims": {…}, "axioms": {…}, "proof": "…", "source": "…" }
  }
}
```

| Member         | Value                                                              |
| -------------- | ------------------------------------------------------------------ |
| `format`       | The string `"httpv/1"`.                                            |
| `certificates` | An object mapping each method name to that endpoint's certificate. |

The object MUST contain exactly these members. A future version that adds
members uses a different `format`. Method names are tokens [RFC9110,
Section 9.1]; the methods standardized in [RFC9110] are written in uppercase,
and other methods are case-sensitive.

The response MUST describe the certificates the server currently publishes. It
MUST carry `Content-Type: application/httpv+json` and SHOULD carry
`Cache-Control: no-store` and `Vary: Accept`.

Each certificate MUST be about its own endpoint only, so that a change to one
endpoint does not disturb clients of another. Its claims MAY mention other
endpoints' operations when that is part of this endpoint's guarantee.
Parameterized routes MAY share a certificate when its operation covers the
whole parameter domain.

If the target resource has no certificates, the server responds with
`404 (Not Found)`. If it cannot produce a certificate it publishes, it
responds with `503 (Service Unavailable)`. The content of these error responses
is not specified.

### 4.3. Client processing

The client MUST limit the size of the response content it reads, and SHOULD
reject content larger than 64 KiB. It then classifies the response:

| Response                                                                                     | Outcome                       |
| -------------------------------------------------------------------------------------------- | ----------------------------- |
| `404`, `405`, or `501`; or a `2xx` response whose media type is not `application/httpv+json` | No certificate                |
| Another non-`2xx` status, a network error, a redirect, or a timeout                          | Unavailable                   |
| Content that is not valid UTF-8 JSON, or not an object with exactly the members above        | Invalid                       |
| A valid object without the requested method                                                  | No certificate                |
| A valid object whose certificate for the method is malformed [ZKLEAN]                        | Invalid                       |
| Otherwise                                                                                    | Certificate for the next step |

Every outcome except the last makes the check result `unknown` (Section 5.2).

### 4.4. Caching

Responses to `OPTIONS` are not cacheable [RFC9110, Section 9.3.7], and
servers SHOULD say so with `no-store`. A client that keeps a certificate
between checks MUST still fetch the current one at each check.

## 5. Checking an endpoint

### 5.1. Procedure

A client checks an endpoint's certificate against its requirements and axiom
policy as follows:

1. **Verify.** Verify the certificate as defined by ZKLean [ZKLEAN], using a
   verifier and verifying key that the client selected in advance. Discovery
   MUST NOT select either. Every entry of the certificate's `axioms` MUST
   appear in the axiom policy with the same identity.
2. **Compare.** Every entry of the requirements' `claims` MUST appear in the
   certificate's `claims` with the same identity. The certificate MAY contain
   other claims.

HTTPV compares identities and never searches for implications between claims.
A client whose proof needs a weaker property than the endpoint certifies proves
that property from the certified claims in its own development, and requires
the certified claims.

Comparison by identity is sound because an identity binds the names and
content of everything a statement refers to: equal identities mean the same
statement about the same operations. Consequently, a renamed claim, a changed
statement, or a changed operation never matches.

### 5.2. Results

| Result         | Meaning                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------ |
| `verified`     | The certificate verifies and certifies every required claim.                                     |
| `incompatible` | The certificate verifies, but a required claim is missing or has a different identity.          |
| `unknown`      | Discovery failed, the certificate does not verify or uses an unaccepted axiom, the requirements cannot be read, or the check did not finish. |

An implementation MUST NOT report `unknown` or `incompatible` as `verified`.
What a client does with each result is its own policy: for example, blocking
dependent requests, switching to another provider, or alerting an operator.

## 6. Monitoring

A client that keeps relying on an endpoint SHOULD repeat the check
periodically, and MUST check again before relying on a certificate it has not
yet checked. A monitor:

- MUST bound each check, including verification, by a timeout, and MUST
  discard a result that arrives after the timeout expires;
- MUST stop treating a `verified` result as current once it is older than a
  configured maximum age, even while a later check is still running;
- MUST let the application test, at the point where a request depends on the
  endpoint, that the latest result is `verified` and current, and MUST fail
  that test when no check has completed, the monitor has stopped, or the latest
  result is not `verified`.

A notification of a changed result informs the application; it is not a
substitute for that test.

## 7. Security considerations

### 7.1. What a client verifies and what it trusts

A client verifies that the certified claims have valid proofs under the listed
axioms, assuming the soundness of the ZKLean proof system and of Lean's kernel.
It trusts the origin server to deploy code that behaves as the certified
operation does, and to publish only claims about each endpoint's own behavior.
HTTPV cannot detect a server that behaves differently while publishing an
unchanged certificate. Applications that need more require execution
attestation or proofs about individual responses, which are out of scope.

### 7.2. Transport

HTTPS authenticates the origin server and binds the certificate to the target
resource. Over cleartext HTTP, an attacker can substitute a certificate for
different, valid claims, so clients MUST NOT use `http` outside local
development.

### 7.3. Redirects

A redirect would let another resource answer for the target resource.
Clients MUST NOT follow redirects during discovery.

### 7.4. Axiom policy

A proof is only as strong as its axioms: a certificate that assumes a false
axiom can prove anything. Clients MUST accept only axioms they have reviewed,
by name and identity, and SHOULD accept no more than Lean's standard axioms
unless a custom axiom is justified independently.

### 7.5. Source pointers

`source` is not covered by the proof and may point anywhere. A client MUST use
it only to obtain Lean declarations, and MUST discard any declaration whose
recomputed identity differs from the certified one. A client MUST NOT execute
content fetched from `source`.

### 7.6. Resource exhaustion

Discovery responses are small, but verification costs CPU time. Clients MUST
bound response size (Section 4.3), the duration of each check (Section 6), and
the number of concurrent verifications. Servers can apply ordinary rate
limiting to `OPTIONS` requests.

### 7.7. Time of check and time of use

A check describes the certificate at one moment. A server can change its
certificate, or its behavior, after a client's check. The maximum age in
Section 6 bounds how long a client relies on one check; it does not close the
gap.

### 7.8. Cross-origin use

A user agent sends a CORS preflight request [FETCH] before a cross-origin
discovery request, because `Accept: application/httpv+json` is not a
CORS-safelisted request header. Section 4.1 keeps preflight requests away from
discovery, so the application answers them with its usual CORS policy. A server
that wants browsers on other origins to read its certificates also needs to
allow those origins on the discovery response.

## 8. Privacy considerations

Discovery and periodic checks tell the origin server which clients depend on
which endpoints, and how often they check. Fetching a certificate's `source`
reveals the same to the host that serves it. Clients that consider this
sensitive can lengthen their check interval or fetch sources from a mirror;
because identities are recomputed, a mirror cannot alter what the client
accepts.

## 9. IANA considerations

This document registers the following media type in the "Media Types" registry
[RFC6838]:

- **Type name:** application
- **Subtype name:** httpv+json
- **Required parameters:** none
- **Optional parameters:** none
- **Encoding considerations:** binary; JSON text [RFC8259] in UTF-8.
- **Security considerations:** see Section 7 of this document.
- **Interoperability considerations:** the `format` member identifies the
  version.
- **Published specification:** this document.
- **Applications that use this media type:** HTTPV clients and servers.
- **Fragment identifier considerations:** as for `application/json`.
- **Additional information:** none.
- **Person and email address to contact for further information:** the
  document authors.
- **Intended usage:** COMMON
- **Restrictions on usage:** none
- **Change controller:** the document authors.

## 10. References

### 10.1. Normative references

- **[RFC2119]** Bradner, S., "Key words for use in RFCs to Indicate
  Requirement Levels", BCP 14, RFC 2119, March 1997.
- **[RFC6838]** Freed, N., Klensin, J., and T. Hansen, "Media Type
  Specifications and Registration Procedures", BCP 13, RFC 6838, January 2013.
- **[RFC8174]** Leiba, B., "Ambiguity of Uppercase vs Lowercase in RFC 2119 Key
  Words", BCP 14, RFC 8174, May 2017.
- **[RFC8259]** Bray, T., Ed., "The JavaScript Object Notation (JSON) Data
  Interchange Format", STD 90, RFC 8259, December 2017.
- **[RFC9110]** Fielding, R., Ed., Nottingham, M., Ed., and J. Reschke, Ed.,
  "HTTP Semantics", STD 97, RFC 9110, June 2022.
- **[ZKLEAN]** "ZKLean certificate format", version `zklean/1`,
  <https://github.com/ZeframLou/zklean-dist/blob/main/SPEC.md>.

### 10.2. Informative references

- **[FETCH]** WHATWG, "Fetch Standard", <https://fetch.spec.whatwg.org/>.
- **[LEAN]** "Lean 4", <https://lean-lang.org/>.

## Appendix A. Example

An inventory service publishes a certificate for `POST /units`, proving that
every accepted reservation consumes exactly one unit:

```lean
theorem UnitInventory.conserves (stock : UnitInventory.Stock) :
    UnitInventory.Conserves stock (UnitInventory.POST_units stock)
```

A client stores the same statement, written as an `axiom`, as its
requirements. It gets the identity of the service's theorem. Then:

| Server publishes                                  | Result                                           |
| ------------------------------------------------- | ------------------------------------------------ |
| Version 1, proving `conserves`                    | `verified`                                       |
| Version 2, proving `conserves` and a second claim | `verified`; extra claims are allowed             |
| Version 3, accepting backorders                   | `incompatible`; the operation changed, so `conserves` has a new identity |
| Version 2 with one proof byte altered             | `unknown`; the certificate does not verify       |
