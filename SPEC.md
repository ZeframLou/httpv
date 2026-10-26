# HTTP Verified (HTTPV)

**Version `httpv/1`** · Stable: a change to the wire format takes a new version.
The media type name is provisional until registered (Section 7).

## Abstract

HTTPV lets an HTTP origin server publish, for each endpoint, a ZKLean
certificate proving theorems about the endpoint's behavior, and lets a client
check that certificate against the theorems its own correctness depends on.
Clients discover certificates with `OPTIONS` and verify them locally. Ordinary
requests and responses are unchanged.

## 1. Introduction

A client that depends on a remote API relies on assumptions about the API's
behavior, and the API can change without the client changing. HTTPV makes those
assumptions checkable: the API author states the endpoint's behavior as a Lean
[LEAN] function, proves theorems about it, and publishes a ZKLean [ZKLEAN]
certificate. The client records the theorems it relies on and relies on the
endpoint only while its certificate proves all of them.

### 1.1. Requirements language

The key words "MUST", "MUST NOT", "SHOULD", "SHOULD NOT", and "MAY" in this
document are to be interpreted as described in BCP 14 [RFC2119] [RFC8174] when,
and only when, they appear in all capitals, as shown here.

### 1.2. Terminology

"Resource", "target URI", "method" and "origin server" are used as in HTTP
Semantics [RFC9110]. ZKLean [ZKLEAN] checks Lean [LEAN] proofs inside the SP1
zero-knowledge virtual machine [SP1] and summarizes the result as a short
Groth16 [GROTH16] proof. "Certificate", "claim", "axiom", "identity" and
"requirements" are as in ZKLean:

- a **certificate** names its proved claims and the axioms they use, each with
  an **identity** that covers its name, its statement and everything the
  statement refers to, but not its proof;
- the **statement identity**, the identity ZKLean gives a certificate's claims
  and axioms together;
- **requirements** list claims, with identities, that a certificate must
  prove.

In addition:

- **Endpoint:** one method at one path of an origin, such as `POST /units`.
- **Operation:** the Lean function that defines an endpoint's behavior.
- **Server:** an origin server that publishes certificates (Section 3).
- **Client:** software that discovers and checks them (Sections 3 and 4).
- **Axiom policy:** the axioms, by name and identity, that a client accepts
  certificates to use.
- **Verifier:** a client's implementation of ZKLean verification, with the
  verifier key that identifies ZKLean's checker.

## 2. Overview

```text
 Client                                           Origin server
   │  OPTIONS /units                                   │
   │  Accept: application/httpv+json                   │
   │ ────────────────────────────────────────────────▶ │
   │  200 OK, application/httpv+json                   │
   │  {"format":"httpv/1","certificates":{"POST":…}}   │
   │ ◀──────────────────────────────────────────────── │
   │  verify, compare with requirements                │
   │  POST /units   (only if verified)                 │
   │ ────────────────────────────────────────────────▶ │
```

Discovery uses `OPTIONS` on the endpoint's own resource, so a certificate needs
no URI of its own. [RFC9205], Section 4.5.2, prefers a `Link` header or a
well-known URI for metadata, because `OPTIONS` responses have no URL, are not
cacheable and cost a round trip; HTTPV accepts those costs to keep each
certificate at its endpoint. Sections 5.2 and 5.6 cover two more costs:
intermediaries that answer `OPTIONS` themselves, and browser preflights.

## 3. Discovery

### 3.1. Request

```http
OPTIONS /units HTTP/1.1
Host: inventory.example
Accept: application/httpv+json
Cache-Control: no-cache
```

A client MUST use `https`, except that it MAY use `http` to `localhost` or a
loopback address [RFC6761] when the user allows it. The target URI MUST NOT
contain userinfo or a fragment [RFC3986]. The client SHOULD send
`Cache-Control: no-cache` [RFC9111], for intermediaries that cache `OPTIONS`
despite [RFC9110], and MUST NOT follow redirects.

A server MUST treat an `OPTIONS` request as discovery only if its `Accept`
header field lists the media range `application/httpv+json` itself, not only a
wildcard, without the weight `q=0` [RFC9110, Section 12.4.2], and the request
carries no `Access-Control-Request-Method`, which would make it a CORS preflight
[FETCH]. The request target `*` is never discovery. Every other request is
ordinary.

### 3.2. Response

The server selects certificates by the target URI's path as the URL Standard
[URL] parses it, compared exactly, ignoring the query. It MUST NOT return
certificates for a path that its ordinary routing maps to a resource other than
the endpoints those certificates describe. A
path without certificates gets an ordinary response.

Otherwise, unless the server cannot produce a certificate (below), it MUST
respond `200 (OK)` with
`Content-Type: application/httpv+json` and an I-JSON [RFC7493] object, which
SHOULD stay under 64 KiB and SHOULD carry `Cache-Control: no-store`:

```json
{
  "format": "httpv/1",
  "certificates": {
    "POST": {
      "format": "zklean/1",
      "claims": { "UnitInventory.conserves": "ad56…" },
      "axioms": {},
      "source": "https://inventory.example/units.ndjson",
      "proof": "base64:…"
    }
  }
}
```

The object has exactly the members `format` (`"httpv/1"`) and `certificates`,
which maps each method token [RFC9110, Section 9.1] to that endpoint's
certificate. Method names are case-sensitive; because Fetch [FETCH] uppercases
`DELETE`, `GET`, `HEAD`, `OPTIONS`, `POST` and `PUT`, servers MUST write those
six in uppercase, and clients MUST uppercase them before lookup.

A server SHOULD give each endpoint a certificate about that endpoint only, so a
change to one endpoint does not disturb clients of another. If it cannot
produce a certificate it advertises for the path, for example because a
dynamic source fails, it MUST respond with a `5xx` status not
labeled `application/httpv+json`.

### 3.3. Client processing

A response is **labeled** `application/httpv+json` when its `Content-Type`
media type, compared case-insensitively and ignoring parameters, is
`application/httpv+json`. A client MUST accept up to 64 KiB of decoded content
and MUST bound what it reads. It classifies the response by the first matching
row. Every outcome but the last makes the result `unknown` (Section 4), with
the outcome as its reason.

| Response                                                                      | Outcome                 |
| ----------------------------------------------------------------------------- | ----------------------- |
| Network error, redirect, timeout, or failure reading the content              | `unavailable`           |
| A `2xx` other than `200` labeled `application/httpv+json`                     | `invalid-advertisement` |
| `404`, `405`, `406` or `501`, or a `2xx` not labeled `application/httpv+json` | `missing-certificate`   |
| Any other non-`200` status                                                    | `unavailable`           |
| Content over the client's bound, not UTF-8 JSON, or not the object above      | `invalid-advertisement` |
| The object lacks the endpoint's method                                        | `missing-certificate`   |
| That method's certificate is not well formed [ZKLEAN]                         | `invalid-advertisement` |
| Otherwise                                                                     | The certificate         |

`OPTIONS` responses are not cacheable [RFC9110, Section 9.3.7], so a client
fetches the current certificate at each check.

## 4. Checking an endpoint

A client MUST:

1. verify the certificate as ZKLean defines [ZKLEAN], with a verifier and key it
   chose in advance, never ones the response selects, accepting only axioms in
   its axiom policy with the same identity; and
2. require every claim in its requirements to appear in the certificate's
   `claims` with the same identity. Other claims are allowed.

| Result         | Meaning                                                                   |
| -------------- | ------------------------------------------------------------------------- |
| `verified`     | The certificate verifies and certifies every required claim.              |
| `incompatible` | It verifies, but a required claim is missing or has another identity.     |
| `unknown`      | Discovery failed, it does not verify, or the requirements cannot be read. |

Each result carries a reason. Section 3.3 defines the reasons for failed
discovery; other reasons are local to each implementation.

An implementation MUST NOT report `unknown` or `incompatible` as `verified`.

Equal identities mean the same statement about the same operations, so a
changed statement or operation never matches, nor does a refactored operation
that still satisfies the claim. HTTPV never infers that one claim implies
another: a client needing a weaker property proves it from the certified claims
itself and requires those.

A client that keeps relying on an endpoint SHOULD check it periodically and
send dependent requests only while its latest check returned `verified` and is
recent enough for its purposes.

## 5. Security considerations

### 5.1. What is verified and what is trusted

A client verifies that the certified claims follow from the listed axioms,
assuming the soundness of ZKLean's pinned checker, SP1, and Groth16 [GROTH16]
with its trusted setup. It trusts the server to run code that behaves as the
certified operation does and to publish claims about the endpoint they are
published for. HTTPV cannot detect a server that misbehaves behind an unchanged
certificate, and a check says nothing about the time after it.

### 5.2. Transport and intermediaries

HTTPS authenticates the origin; over cleartext an attacker could substitute a
different valid certificate. A redirect would let another resource answer.
Gateways and CDNs often answer `OPTIONS` themselves, which reads as "no
certificate", so clients that depend on the certificate SHOULD treat every
`unknown` result as a failure.

### 5.3. Requirements and axioms

A check means only what the requirements say. Clients SHOULD write requirements
from Lean declarations they have reviewed, about the operation they call, and
SHOULD NOT copy them from the certificate being checked. A false axiom proves
anything, so clients SHOULD accept only reviewed axioms, normally no more than
Lean's standard three, and never `sorryAx`, `Lean.ofReduceBool` or
`Lean.trustCompiler`.

### 5.4. Replay and malleability

A certificate has no validity period and is bound to no origin or deployment: an
old certificate served by a stale replica or rolled-back deployment still
verifies. Groth16 proofs can be re-randomized, so clients MUST NOT treat a
change in certificate bytes as a change in what is certified; the statement
identity [ZKLEAN] identifies that.

### 5.5. Sources and resource use

`source` is not covered by the proof; ZKLean defines how to fetch it safely
[ZKLEAN]. Verification costs CPU time, so clients SHOULD bound how long a check
runs and how many run at once; servers can rate-limit `OPTIONS`.

### 5.6. Cross-origin use

`OPTIONS` is not a CORS-safelisted method, so browsers send a preflight first,
which the application answers (Section 3.1). For browsers on another origin to
discover certificates, the preflight needs to allow `OPTIONS` and the
`Cache-Control` request header, and the discovery response needs
`Access-Control-Allow-Origin`.

## 6. Privacy considerations

Checks tell the origin which clients depend on which endpoints and how often
they check, and fetching a `source` tells its host the same. Clients can check
less often or fetch sources from a mirror; identities are recomputed, so a
mirror cannot change what is accepted.

## 7. IANA considerations

This specification requests no registration yet: the standards tree requires an
IETF-approved specification with the IETF as change controller [RFC6838,
Section 3.1], so until then the name is for experimental use and may change.
Template for a future registration:

- **Type name:** application
- **Subtype name:** httpv+json
- **Required parameters:** none
- **Optional parameters:** none
- **Encoding considerations:** binary; JSON text [RFC8259] in UTF-8.
- **Security considerations:** no active or executable content; carries proofs
  verified with a key the recipient chose; `source` URLs are untrusted. See
  Section 5.
- **Interoperability considerations:** recipients reject a `format` other than
  `httpv/1`; later versions use a different media type.
- **Published specification:** this document.
- **Applications that use this media type:** HTTPV clients and servers.
- **Fragment identifier considerations:** as for `+json` [RFC6839], Section
  3.1.
- **Additional information:** deprecated alias names, magic numbers, file
  extensions and Macintosh file type codes: N/A.
- **Person and email address to contact for further information:** IESG
  <iesg@ietf.org>.
- **Intended usage:** COMMON
- **Restrictions on usage:** none
- **Author:** see Appendix B.
- **Change controller:** IETF.

## 8. References

### 8.1. Normative references

- **[FETCH]** WHATWG, "Fetch Standard", <https://fetch.spec.whatwg.org/>.
- **[RFC2119]** Bradner, S., "Key words for use in RFCs to Indicate
  Requirement Levels", BCP 14, RFC 2119, March 1997.
- **[RFC3986]** Berners-Lee, T., Fielding, R., and L. Masinter, "Uniform
  Resource Identifier (URI): Generic Syntax", STD 66, RFC 3986, January 2005.
- **[RFC6761]** Cheshire, S. and M. Krochmal, "Special-Use Domain Names",
  RFC 6761, February 2013.
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
- **[ZKLEAN]** "ZKLean certificate format", version `zklean/1`, ZKLean
  release `v0.1.0`, <https://github.com/ZeframLou/zklean/blob/v0.1.0/SPEC.md>.

### 8.2. Informative references

- **[GROTH16]** Groth, J., "On the Size of Pairing-Based Non-interactive
  Arguments", EUROCRYPT 2016.
- **[LEAN]** "Lean 4", <https://lean-lang.org/>.
- **[RFC6838]** Freed, N., Klensin, J., and T. Hansen, "Media Type
  Specifications and Registration Procedures", BCP 13, RFC 6838, January 2013.
- **[RFC6839]** Hansen, T. and A. Melnikov, "Additional Media Type Structured
  Syntax Suffixes", RFC 6839, January 2013.
- **[RFC9205]** Nottingham, M., "Building Protocols with HTTP", BCP 56,
  RFC 9205, June 2022.
- **[SP1]** Succinct, "SP1", version 6.10.0,
  <https://github.com/succinctlabs/sp1/tree/v6.10.0>.

## Appendix A. Example

An inventory service proves, for `POST /units`, that every accepted reservation
consumes exactly one unit:

```lean
theorem UnitInventory.conserves (stock : UnitInventory.Stock) :
    UnitInventory.Conserves stock (UnitInventory.POST_units stock)
```

A client states the same proposition as an `axiom` over identical definitions,
which gives the same identity, and requires it:

| Server publishes                                  | Result                                                  |
| ------------------------------------------------- | ------------------------------------------------------- |
| Version 1, proving `conserves`                    | `verified`                                              |
| Version 2, proving `conserves` and a second claim | `verified`                                              |
| Version 3, accepting backorders                   | `incompatible`: the operation and the statement changed |
| Version 2 with one proof byte altered             | `unknown`: the certificate does not verify              |

## Appendix B. Author

ZeframLou, <https://github.com/ZeframLou>.
