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

Appendix A. [Example](#appendix-a-example) ·
Appendix B. [Author](#appendix-b-author)

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
meaning. A client records the identities its correctness depends on and
accepts the endpoint only while its current certificate proves all of them.

### 1.1. Requirements language

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD",
"SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this
document are to be interpreted as described in BCP 14 [RFC2119] [RFC8174] when,
and only when, they appear in all capitals, as shown here.

### 1.2. Conformance

This document places requirements on three roles:

- a **server**: an origin server that publishes certificates (Sections 4.1
  and 4.2);
- a **client**: software that discovers and checks certificates (Sections 3.2,
  4.1, 4.3, 4.4, 5, 7.5 and 7.6);
- a **monitor**: a client component that repeats checks and gates dependent
  requests (Sections 6 and 7.7).

### 1.3. Terminology

This document uses the terms "resource", "target resource", "target URI",
"method", "origin server", and "user agent" as defined in HTTP Semantics
[RFC9110], and "JSON text" as defined in [RFC8259].

- **Endpoint:** one method of the resources an origin serves at one path,
  such as `POST /units` at `https://inventory.example`. The query is not part
  of it.
- **Operation:** the Lean function that defines an endpoint's behavior.
- **Claim:** a proposition proved about one or more operations, named by its
  fully qualified Lean name.
- **Axiom:** a proposition assumed without proof.
- **Identity:** a 64-character lowercase hexadecimal SHA-256 digest that ZKLean
  computes for a declaration. It covers the declaration's name and statement
  and, transitively, the name and content of every declaration the statement
  refers to, including operation bodies. It does not cover proofs.
- **Certificate:** a ZKLean certificate (Section 3.1).
- **Statement identity:** the digest ZKLean defines over a certificate's
  `format`, `claims`, and `axioms`, which is what its proof proves.
- **Requirements:** the claims, by name and identity, that a client's
  correctness depends on for one endpoint (Section 3.2).
- **Axiom policy:** the axioms, by name and identity, that a client accepts.

## 2. Overview

```text
 Client                                           Origin server
   │  OPTIONS /units                                   │
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
   │  POST /units   (only if verified)                 │
   │ ────────────────────────────────────────────────▶ │
```

1. The client asks the target resource for its certificates (Section 4).
2. It verifies the certificate for the method it will use, under its axiom
   policy, and checks that every required claim is certified with the same
   identity (Section 5).
3. It sends dependent requests only while the latest check succeeded and is
   recent enough (Section 6).

Discovery uses `OPTIONS` on the target resource itself. [RFC9205],
Section 4.5.2, recommends a `Link` header field or a well-known URI for
metadata instead, because `OPTIONS` responses have no URL of their own, are not
cacheable, add a round trip, and are not supported everywhere. HTTPV accepts
those costs so that each endpoint's certificate is found at the endpoint itself,
with no second URI to keep consistent with it. This document adds two costs:
intermediaries often answer `OPTIONS` themselves (Section 7.2), and browsers
send a preflight first (Section 7.9).

## 3. Certificates and requirements

### 3.1. Certificates

Certificates use the ZKLean format [ZKLEAN], which defines their encoding,
validation, and verification; this section is informative. A certificate is a
JSON object whose members are:

| Member   | Value                                                                  |
| -------- | ---------------------------------------------------------------------- |
| `format` | The string `"zklean/1"`.                                               |
| `claims` | A non-empty object mapping each proved claim's name to its identity.   |
| `axioms` | An object mapping each axiom the proofs use to its identity.           |
| `proof`  | A succinct proof of the statement formed by `format`, `claims`, `axioms`. |
| `source` | The URL of a Lean export containing the claims and what they refer to. |

The proof does not cover `source`, which only tells a reader where to find the
Lean declarations behind the identities (Section 7.6).

Two claims with the same name and identity are the same statement about the
same operations. A claim stated as a Lean `axiom` has the same identity as a
theorem with the same statement, so requirements can be written without proofs.

### 3.2. Requirements

Requirements are a ZKLean requirements object [ZKLEAN]:

```json
{
  "format": "zklean/requirements/1",
  "claims": { "UnitInventory.conserves": "ad56…" }
}
```

A client MUST treat requirements as unusable (Section 5.2) unless they are a
JSON object with exactly two members: `format`, whose value is
`"zklean/requirements/1"`, and `claims`, a non-empty object mapping non-empty
names to identities. Requiring nothing would accept every certificate that
verifies. Section 7.3 explains how to choose requirements.

## 4. Discovery

### 4.1. Request

A client discovers an endpoint's certificate by sending `OPTIONS` to the
target resource:

```http
OPTIONS /units HTTP/1.1
Host: inventory.example
Accept: application/httpv+json
Cache-Control: no-cache
```

The client MUST use the `https` scheme. It MAY use `http`, when the user has
explicitly allowed it, for a host that is a loopback IP address or the name
`localhost` [RFC6761, Section 6.3]. The target URI MUST NOT contain userinfo
[RFC9110, Section 4.2.4] or a fragment [RFC3986]. The
client SHOULD send `Cache-Control: no-cache` [RFC9111] and MUST NOT follow
redirects.

An `OPTIONS` request is a discovery request only if all of the following hold.
A server MUST process any other `OPTIONS` request as an ordinary request:

- the request target is not `*` [RFC9110, Section 9.3.7];
- the `Accept` header field contains the media range `application/httpv+json`
  itself, not only a wildcard such as `*/*`, with no parameter other than an
  optional weight [RFC9110, Section 12.4.2] whose value is greater than zero; a
  range with any other parameter or an invalid weight does not count;
- the request has no `Access-Control-Request-Method` header field, which would
  make it a CORS preflight request [FETCH].

### 4.2. Response

The server selects the certificates by the path of the target URI as the URL
Standard [URL] parses it, which removes dot segments and does not decode
percent-encoding, compared exactly; the query is not used. A server MUST NOT
return certificates for a path that its ordinary request routing maps to a
different resource. If the path has no certificates, the server MUST process
the request as an ordinary `OPTIONS` request.

Otherwise the server MUST respond with `200 (OK)` and `Content-Type:
application/httpv+json`, with content that is a JSON text [RFC8259] in UTF-8
and an I-JSON message [RFC7493]. The content, after removing content codings,
SHOULD NOT exceed 64 KiB:

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

The object MUST contain exactly these members. This document defines only
version 1; a later version will use a different media type, so that clients
can ask for the versions they support.

The keys of `certificates` are method tokens [RFC9110, Section 9.1] and are
compared case-sensitively. Fetch [FETCH] normalizes the methods `DELETE`,
`GET`, `HEAD`, `OPTIONS`, `POST` and `PUT` to uppercase, so a server MUST
write those six in uppercase, and a client MUST normalize them the same way
before looking a method up. A certificate for `GET` does not cover `HEAD`.

The server SHOULD send `Cache-Control: no-store`, and SHOULD send `Allow`
[RFC9110, Section 9.3.7] when it knows the resource's methods. A server MUST
publish only certificates whose `source` is an `https` URL (Section 7.6).

If the server cannot produce a certificate it publishes for the path, it MUST
respond with a `5xx` status such as `503 (Service Unavailable)`, and the
response MUST NOT be labeled `application/httpv+json`. A server that builds the whole response at once makes
one endpoint's failure affect its siblings; this document does not define a
partial response.

A server SHOULD publish, under each method, a certificate whose claims are
about that endpoint, so that a change to one endpoint does not disturb clients
of another. Claims MAY mention other endpoints' operations when that is part of
this endpoint's guarantee. Parameterized routes MAY share a certificate when its
operation covers the whole parameter domain.

### 4.3. Client processing

The client MUST accept content of up to 64 KiB after removing content codings,
MUST limit how much it reads, and MAY reject larger content. It classifies the
response by the first matching row below. Every outcome except
the last makes the check result `unknown` (Section 5.2).

| Response                                                                                             | Outcome          |
| ---------------------------------------------------------------------------------------------------- | ---------------- |
| A network error, a redirect, a timeout, or a failure while reading the content                       | Unavailable      |
| A `2xx` status other than `200` labeled `application/httpv+json`                                     | Invalid          |
| `404 (Not Found)`, `405 (Method Not Allowed)`, `406 (Not Acceptable)` or `501 (Not Implemented)`; or a `2xx` response not labeled `application/httpv+json` | No certificate |
| Any other status other than `200 (OK)`                                                               | Unavailable      |
| Content over the size limit, not valid UTF-8 JSON, or not an object with exactly the members above   | Invalid          |
| A valid object without the requested method                                                          | No certificate   |
| A valid object whose certificate for that method is not well formed [ZKLEAN]                         | Invalid          |
| Otherwise                                                                                            | The certificate  |

A client MUST validate the certificate for the requested method and SHOULD
ignore the others. A client MAY reject content with duplicate member names as
invalid; whichever certificate it reads, it then verifies that certificate.

### 4.4. Caching

Responses to `OPTIONS` are not cacheable [RFC9110, Section 9.3.7]. A client
that keeps a certificate between checks MUST still fetch the current one at
each check.

## 5. Checking an endpoint

### 5.1. Procedure

A client checks an endpoint's certificate against its requirements and axiom
policy:

1. **Verify.** Verify the certificate as defined by ZKLean [ZKLEAN], with a
   verifier and verifying key that the client selected in advance. Discovery
   MUST NOT select either. Every entry of the certificate's `axioms` MUST
   appear in the axiom policy with the same identity.
2. **Compare.** Every entry of the requirements' `claims` MUST appear in the
   certificate's `claims` with the same identity. The certificate MAY contain
   other claims.

HTTPV compares identities and never searches for implications between claims.
A client whose correctness needs a weaker property than the endpoint certifies
proves that property from the certified claims in its own development, and
requires the certified claims.

Comparison by identity is sound because an identity binds the names and
content of everything a statement refers to: equal identities mean the same
statement about the same operations. A renamed claim, a changed statement, or
a changed operation therefore never matches. So does a refactored operation
that still satisfies the claim; its requirements then need review.

### 5.2. Results

| Result         | Meaning                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------- |
| `verified`     | The certificate verifies and certifies every required claim.                             |
| `incompatible` | The certificate verifies, but a required claim is missing or has a different identity.  |
| `unknown`      | Discovery failed, the certificate does not verify or uses an axiom outside the policy, the requirements are unusable, or the check did not finish. |

An implementation MUST NOT report `unknown` or `incompatible` as `verified`.
What a client does with each result is its own policy: for example, blocking
dependent requests, switching to another provider, or alerting an operator.

## 6. Monitoring

A monitor repeats the check for an endpoint. It:

- MUST bound each check, including verification, by a timeout, and MUST
  discard a result that arrives after the timeout expires;
- MUST measure a result's age from a time no later than when it sent the
  discovery request that produced it;
- MUST stop treating a `verified` result as current once its age reaches a
  configured maximum, even while a later check is still running;
- SHOULD start checks at a fixed interval, measured between the starts of
  consecutive checks, and SHOULD set the maximum age to at least that interval
  plus the timeout, so that requests are not blocked between two successful
  checks;
- MUST let the application test, where a request depends on the endpoint,
  that the latest result is `verified` and current, and MUST fail that test
  until a check has completed with `verified`, after the monitor has stopped,
  and whenever the latest result is not `verified`;
- SHOULD run at most one check at a time per endpoint, including a check
  abandoned at its timeout whose verification is still running.

A notification of a changed result informs the application; it is not a
substitute for that test.

## 7. Security considerations

### 7.1. What a client verifies and what it trusts

A client verifies that the certified claims have valid proofs under the listed
axioms, assuming the soundness of the ZKLean proof system and of Lean's kernel.
It trusts the origin server to run code that behaves as the certified operation
does, and to publish claims about the endpoint they are published for. HTTPV
cannot detect a server that behaves differently while publishing an unchanged
certificate. Applications that need more require execution attestation or
proofs about individual responses, which are out of scope.

### 7.2. Transport, redirects and intermediaries

HTTPS authenticates the origin server. Over cleartext HTTP, an attacker can
substitute a certificate for different, valid claims; this is why plain HTTP
is limited to loopback hosts (Section 4.1). A redirect would let another
resource answer for the target resource, so clients do not follow one.

Gateways, CDNs and CORS middleware often answer `OPTIONS` themselves without
forwarding it. Their response reads as "no certificate", which is
indistinguishable from an origin that publishes none. Clients whose correctness
depends on the certificate SHOULD treat every `unknown` result as a failure.

### 7.3. Choosing requirements

A check is only as meaningful as the requirements behind it. A client SHOULD
write its requirements from Lean declarations it has reviewed, and SHOULD NOT
copy them from the certificate it is about to check. The required claims
SHOULD be about the operation the client expects the endpoint to implement:
their identities then fix that operation's definition, and a certificate for a
different endpoint does not contain them.

### 7.4. Axiom policy

A proof is only as strong as its axioms: a certificate that assumes a false
axiom can prove anything. Clients SHOULD accept only axioms they have reviewed,
by name and identity, and no more than Lean's standard axioms (`propext`,
`Quot.sound` and `Classical.choice`) unless a custom axiom is justified
independently. Clients SHOULD NOT accept `sorryAx`, `Lean.ofReduceBool`, or
`Lean.trustCompiler`.

### 7.5. Replay and stale certificates

A certificate carries no validity period and is not bound to an origin, a
resource, or a deployment. A certificate that verified once verifies forever,
for anyone who presents it. A client therefore cannot tell a current
certificate from an earlier one served by a stale replica, a rolled-back
deployment, or an intermediary that caches `OPTIONS` responses against
[RFC9110], as long as its claims still match. HTTPV detects changes in what is
certified, not when a certification was made.

Groth16 [GROTH16] proofs can be re-randomized into other valid proofs of the
same statement, so certificate bytes are not a stable identifier. Clients MUST
NOT treat a change in certificate bytes as a change in what is certified; the
statement identity identifies that.

### 7.6. Source pointers

`source` is not covered by the proof and may point anywhere. A client MUST use
it only to obtain Lean declarations, MUST discard the whole export unless it
reproduces every certified identity [ZKLEAN], and MUST NOT execute content
fetched from it. A client MUST NOT dereference a `source` that is not
an `https` URL when the certificate came over the network, so that a
certificate cannot direct it to local files. It SHOULD NOT dereference a
`source` whose host resolves to a loopback, link-local, or private address
unless configured to, and MUST bound the size of what it fetches.

### 7.7. Resource exhaustion

Discovery responses are small, but verification costs CPU time, and a server
that re-randomizes its proof on every response defeats caching by certificate
bytes. Clients MUST bound response size (Section 4.3); a monitor MUST bound the
duration of each check (Section 6), and other clients SHOULD bound
verification time. Clients SHOULD bound the number of concurrent
verifications.
Servers can apply ordinary rate limiting to `OPTIONS` requests.

### 7.8. Time of check and time of use

A check describes the certificate at one moment. A server can change its
certificate, or its behavior, after a client's check. The maximum age in
Section 6 bounds how long a client relies on one check; it does not close the
gap.

### 7.9. Cross-origin use

`OPTIONS` is not a CORS-safelisted method, so a user agent sends a CORS
preflight request [FETCH] before a cross-origin discovery request. Section 4.1
keeps preflight requests away from discovery, so the application answers them
with its usual CORS policy. For browsers on another origin to discover
certificates, the preflight response needs to allow the method `OPTIONS` and
the request header `Cache-Control`, and the discovery response needs
`Access-Control-Allow-Origin` for that origin.

## 8. Privacy considerations

Discovery and periodic checks tell the origin server which clients depend on
which endpoints, and how often they check. Fetching a certificate's `source`
reveals the same to the host that serves it. Clients that consider this
sensitive can lengthen their check interval or fetch sources from a mirror;
because identities are recomputed, a mirror cannot alter what the client
accepts.

## 9. IANA considerations

This draft requests no registration yet. A registration in the standards tree
requires an IETF-approved specification with the IETF as change controller
[RFC6838, Section 3.1]. Until then, deployments use the name below without
registration, at the risk that a registration changes it. The template for a
future registration is:

- **Type name:** application
- **Subtype name:** httpv+json
- **Required parameters:** none
- **Optional parameters:** none
- **Encoding considerations:** binary; JSON text [RFC8259] in UTF-8.
- **Security considerations:** The content is data and contains no executable
  or active content. It carries cryptographic proofs that a recipient verifies
  with a verifying key it chose; the content cannot select that key. Its
  `source` members are untrusted URLs. See Section 7 of this document.
- **Interoperability considerations:** recipients MUST reject a `format`
  other than `httpv/1`; later versions use a different media type.
- **Published specification:** this document.
- **Applications that use this media type:** HTTPV clients and servers.
- **Fragment identifier considerations:** as specified for `+json` in
  [RFC6839], Section 3.1.
- **Additional information:**
  - Deprecated alias names for this type: N/A
  - Magic number(s): N/A
  - File extension(s): N/A
  - Macintosh file type code(s): N/A
- **Person and email address to contact for further information:** to be
  assigned on registration.
- **Intended usage:** COMMON
- **Restrictions on usage:** none
- **Author:** see Appendix B.
- **Change controller:** IETF.

## 10. References

### 10.1. Normative references

- **[FETCH]** WHATWG, "Fetch Standard", <https://fetch.spec.whatwg.org/>.
- **[RFC2119]** Bradner, S., "Key words for use in RFCs to Indicate
  Requirement Levels", BCP 14, RFC 2119, March 1997.
- **[RFC3986]** Berners-Lee, T., Fielding, R., and L. Masinter, "Uniform
  Resource Identifier (URI): Generic Syntax", STD 66, RFC 3986, January 2005.
- **[RFC6761]** Cheshire, S. and M. Krochmal, "Special-Use Domain Names",
  RFC 6761, February 2013.
- **[RFC6838]** Freed, N., Klensin, J., and T. Hansen, "Media Type
  Specifications and Registration Procedures", BCP 13, RFC 6838, January 2013.
- **[RFC6839]** Hansen, T. and A. Melnikov, "Additional Media Type Structured
  Syntax Suffixes", RFC 6839, January 2013.
- **[RFC7493]** Bray, T., Ed., "The I-JSON Message Format", RFC 7493,
  March 2015.
- **[RFC8174]** Leiba, B., "Ambiguity of Uppercase vs Lowercase in RFC 2119 Key
  Words", BCP 14, RFC 8174, May 2017.
- **[RFC8259]** Bray, T., Ed., "The JavaScript Object Notation (JSON) Data
  Interchange Format", STD 90, RFC 8259, December 2017.
- **[RFC9110]** Fielding, R., Ed., Nottingham, M., Ed., and J. Reschke, Ed.,
  "HTTP Semantics", STD 97, RFC 9110, June 2022.
- **[RFC9111]** Fielding, R., Ed., Nottingham, M., Ed., and J. Reschke, Ed.,
  "HTTP Caching", STD 98, RFC 9111, June 2022.
- **[URL]** WHATWG, "URL Standard", <https://url.spec.whatwg.org/>.
- **[ZKLEAN]** "ZKLean certificate format", version `zklean/1`, commit
  `da87c31e6ee5985c0d83f1a92f89fff23cb3fe04`,
  <https://github.com/ZeframLou/zklean/blob/da87c31e6ee5985c0d83f1a92f89fff23cb3fe04/SPEC.md>.

### 10.2. Informative references

- **[GROTH16]** Groth, J., "On the Size of Pairing-Based Non-interactive
  Arguments", EUROCRYPT 2016.
- **[LEAN]** "Lean 4", <https://lean-lang.org/>.
- **[RFC9205]** Nottingham, M., "Building Protocols with HTTP", BCP 56,
  RFC 9205, June 2022.

## Appendix A. Example

An inventory service publishes a certificate for `POST /units`, proving that
every accepted reservation consumes exactly one unit:

```lean
theorem UnitInventory.conserves (stock : UnitInventory.Stock) :
    UnitInventory.Conserves stock (UnitInventory.POST_units stock)
```

A client states the same proposition as an `axiom`, over identical
definitions of the operation and the types it uses, and generates its
requirements from it; that gives the identity of the service's theorem. Then:

| Server publishes                                  | Result                                                                    |
| ------------------------------------------------- | ------------------------------------------------------------------------- |
| Version 1, proving `conserves`                    | `verified`                                                                |
| Version 2, proving `conserves` and a second claim | `verified`; extra claims are allowed                                      |
| Version 3, accepting backorders                   | `incompatible`; the operation changed, so `conserves` has a new identity |
| Version 2 with one proof byte altered             | `unknown`; the certificate does not verify                                |

## Appendix B. Author

ZeframLou, <https://github.com/ZeframLou>.
