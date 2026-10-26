# HTTP Verified (HTTPV)

**Version `httpv/1`** · Stable: a change to the wire format takes a new version.
The media type name is provisional until registered (Section 6).

## Abstract

An origin server publishes, for each endpoint, a ZKLean certificate proving
theorems about its behavior. A client discovers it with `OPTIONS`, verifies it
locally, and checks it proves the theorems the client depends on. This
document is for implementers; library users should read the
[usage guide](docs/USAGE.md).

## 1. Conventions and terminology

The key words "MUST", "MUST NOT", "SHOULD", "SHOULD NOT", and "MAY" in this
document are to be interpreted as described in BCP 14 [RFC2119] [RFC8174] when,
and only when, they appear in all capitals, as shown here.

"Resource", "target URI", "method" and "origin server" are as in [RFC9110].
ZKLean [ZKLEAN] checks Lean [LEAN] proofs inside the SP1 virtual machine [SP1]
and summarizes the result as a Groth16 [GROTH16] proof. **Certificate**,
**claim**, **axiom**, **identity** and **statement digest** [ZKLEAN, Section 1],
**requirements** [ZKLEAN, Section 6] and a certificate's **source**, the URL of
its export [ZKLEAN, Section 5], are as in ZKLean. In addition:

- **Endpoint:** one method at one path of an origin, such as `POST /units`.
- **Operation:** the Lean function that defines an endpoint's behavior.
- **Axiom policy:** the axioms, by name and identity, a client accepts.
- **Verifier:** ZKLean verification with the key that identifies its checker.
- **Labeled:** a response is labeled `application/httpv+json` (labeled, for
  short) when its `Content-Type` media type, compared case-insensitively and
  ignoring parameters, is `application/httpv+json`.

## 2. Discovery

Discovery uses `OPTIONS` on the endpoint's own resource, so a certificate needs
no URI of its own, despite [RFC9205, Section 4.5.2]'s preference for a `Link`
or well-known URI.

### 2.1. Request

```http
OPTIONS /units HTTP/1.1
Host: inventory.example
Accept: application/httpv+json
Cache-Control: no-cache
```

A client:

- MUST send `OPTIONS` to the endpoint's target URI with an `Accept` header
  field listing `application/httpv+json`;
- MUST use `https`, but MAY use `http` to the host name `localhost` itself
  [RFC6761] or a loopback address (`127.0.0.0/8` or `::1`) when the user allows
  it;
- MUST NOT use a target URI with userinfo or a fragment [RFC3986];
- SHOULD send `Cache-Control: no-cache` [RFC9111];
- MUST NOT follow redirects.

A server MUST treat an `OPTIONS` request as discovery if and only if:

- its target is not `*`;
- its `Accept` lists the media range `application/httpv+json` itself (not only
  a wildcard), compared case-insensitively and ignoring parameters other than
  `q`, without `q=0` [RFC9110, Section 12.4.2]; and
- it has no `Access-Control-Request-Method`, whose presence makes it a CORS
  preflight [FETCH].

Every other request is ordinary.

### 2.2. Response

The server selects certificates by the target URI's path as the URL Standard
[URL] parses it, compared exactly, ignoring the query. It MUST NOT return
certificates for a path that its ordinary routing maps to a resource other than
the endpoints they describe. A path without certificates gets an ordinary
response.

For a path with certificates, the server MUST respond `200 (OK)` with
`Content-Type: application/httpv+json` and an I-JSON [RFC7493] object that
SHOULD stay under 64 KiB and SHOULD carry `Cache-Control: no-store`. If it
cannot produce a certificate it advertises for the path, it MUST instead
respond with a `5xx` status that is not labeled. A server SHOULD give each
endpoint a certificate about that endpoint only.

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
an object mapping method tokens [RFC9110, Section 9.1] to certificates.

- A server MUST NOT repeat a member name; a client need not detect repeats.
- A client MUST treat content as not this object if it is not an object with
  exactly these members, has another `format`, or has a `certificates` that is
  not an object. It reads only its method's member of `certificates` and MUST
  NOT validate the other members' names or values.
- Method names are case-sensitive, but Fetch [FETCH] uppercases `DELETE`,
  `GET`, `HEAD`, `OPTIONS`, `POST` and `PUT`. Servers MUST write those six in
  uppercase, and a client whose method matches one of them, ignoring case, MUST
  look it up in uppercase.

### 2.3. Client processing

A client MUST accept up to 64 KiB of decoded content and MUST bound what it
reads. The first matching row classifies the response. Every outcome but the
last gives the result `unknown` with the outcome as its reason. `OPTIONS`
responses are not cacheable [RFC9110, Section 9.3.7], so each check fetches
the current certificate.

| Response                                                                                         | Outcome                 |
| ------------------------------------------------------------------------------------------------ | ----------------------- |
| A target URI Section 2.1 forbids, or a method that is not a token                                | `unavailable`           |
| Network error, redirect, timeout, or failure reading the content                                 | `unavailable`           |
| A labeled `2xx` other than `200`                                                                 | `invalid-advertisement` |
| `404`, `405`, `406` or `501`, or an unlabeled `2xx`                                              | `missing-certificate`   |
| Any other non-`200` status                                                                       | `unavailable`           |
| Content over the bound (including a read stopped there), not UTF-8 JSON, or not the object above | `invalid-advertisement` |
| No member for the endpoint's method                                                              | `missing-certificate`   |
| That certificate is not well formed [ZKLEAN, Section 3]                                          | `invalid-advertisement` |
| Otherwise                                                                                        | The certificate         |

## 3. Checking an endpoint

A client MUST:

1. verify the certificate as ZKLean defines [ZKLEAN, Section 4], with a
   verifier and key chosen in advance, never selected by the response,
   accepting only axioms in its axiom policy with the same identity; and
2. require every claim in its requirements among the certificate's `claims`
   with the same identity; other claims are allowed. Requirements with no
   claims MUST yield `unknown`.

| Result         | Meaning                                                                                        |
| -------------- | ---------------------------------------------------------------------------------------------- |
| `verified`     | It verifies and certifies every required claim.                                                |
| `incompatible` | It verifies, but a required claim is missing or has another identity.                          |
| `unknown`      | Discovery failed, it does not verify under the axiom policy, or the requirements are unusable. |

Each result carries a reason. Section 2.3 defines discovery's reasons; other
reasons are local to each implementation. An implementation MUST NOT report
`unknown` or `incompatible` as `verified`.

Equal identities mean the same statement about the same operations, so any
change to either, even a refactor, never matches. HTTPV never infers one claim
from another.

A client that keeps relying on an endpoint SHOULD check it periodically and send
dependent requests only while its latest check returned `verified` and is
recent enough for its purposes.

## 4. Security considerations

- **Trust.** A check shows the certified claims follow from the listed axioms,
  if ZKLean's checker, SP1 and Groth16 (with its trusted setup) are sound. The
  server is trusted to run code that behaves as the certified operation, about
  the right endpoint. A check says nothing about later times.
- **Transport.** Cleartext or a redirect would let another party answer.
  Gateways often answer `OPTIONS` themselves, so clients that depend on a
  certificate SHOULD treat every `unknown` as a failure.
- **Requirements and axioms.** Clients SHOULD write requirements from Lean
  declarations they have reviewed, about the operation they call, and SHOULD
  NOT copy them from the certificate being checked. A false axiom proves
  anything, so clients SHOULD accept only reviewed axioms, normally no more than
  Lean's standard three, and never `sorryAx`, `Lean.ofReduceBool` or
  `Lean.trustCompiler`.
- **Replay and malleability.** A certificate is bound to no time, origin or
  deployment, so a stale replica's still verifies. Groth16 proofs can be
  re-randomized, so clients MUST NOT treat changed certificate bytes as a
  change in what is certified; the statement digest identifies that.
- **Sources and resources.** `source` is outside the proof; ZKLean defines
  fetching it safely [ZKLEAN, Section 5]. Clients SHOULD bound how long a check
  runs and how many run at once; servers can rate-limit `OPTIONS`.
- **Cross-origin use.** `OPTIONS` is not CORS-safelisted, so browsers send a
  preflight, which the application answers (Section 2.1). For other origins to
  discover certificates, the preflight response needs to allow `OPTIONS` and
  the `Cache-Control` request header, and discovery responses need
  `Access-Control-Allow-Origin`.
- **Privacy.** Checks tell the origin which clients depend on which endpoints;
  fetching a `source` tells its host the same.

## 5. Example

An inventory service models `POST /units` as `UnitInventory.POST_units` and
proves that every accepted reservation consumes exactly one unit and only empty
stock is rejected:

```lean
theorem UnitInventory.conserves (stock : UnitInventory.Stock) :
    UnitInventory.Conserves stock (UnitInventory.POST_units stock)
```

A client states the same proposition as an `axiom` over identical definitions,
giving the same identity, and requires it.

Version 1, and version 2 with an extra claim, give `verified`. Version 3,
which accepts backorders, gives `incompatible`: the claim refers to a changed
function. Version 2 with one proof byte altered gives `unknown`.

## 6. IANA considerations

No registration of `application/httpv+json` is requested until an
IETF-approved specification exists [RFC6838, Section 3.1]; until then the name
is for experimental use. Its fragment identifiers are as for `+json` [RFC6839,
Section 3.1].

## 7. References

### 7.1. Normative

- **[FETCH]** WHATWG Fetch Standard, <https://fetch.spec.whatwg.org/>.
- **[RFC2119]** RFC 2119, Key words for use in RFCs (BCP 14).
- **[RFC3986]** RFC 3986, URI Generic Syntax (STD 66).
- **[RFC6761]** RFC 6761, Special-Use Domain Names.
- **[RFC7493]** RFC 7493, The I-JSON Message Format.
- **[RFC8174]** RFC 8174, Ambiguity of Uppercase vs Lowercase in RFC 2119 Key
  Words (BCP 14).
- **[RFC9110]** RFC 9110, HTTP Semantics (STD 97).
- **[RFC9111]** RFC 9111, HTTP Caching (STD 98).
- **[URL]** WHATWG URL Standard, <https://url.spec.whatwg.org/>.
- **[ZKLEAN]** ZKLean certificate format `zklean/1`, release `v0.1.0`,
  <https://github.com/ZeframLou/zklean/blob/v0.1.0/SPEC.md>.

### 7.2. Informative

- **[GROTH16]** Groth, J., "On the Size of Pairing-Based Non-interactive
  Arguments", EUROCRYPT 2016.
- **[LEAN]** Lean 4, <https://lean-lang.org/>.
- **[RFC6838]** RFC 6838, Media Type Specifications and Registration
  Procedures (BCP 13).
- **[RFC6839]** RFC 6839, Additional Media Type Structured Syntax Suffixes.
- **[RFC9205]** RFC 9205, Building Protocols with HTTP (BCP 56).
- **[SP1]** Succinct SP1 6.10.0, <https://github.com/succinctlabs/sp1/tree/v6.10.0>.
