# HTTPV

HTTPV is an HTTP protocol and TypeScript library that lets clients discover
an API's formal guarantees and check whether updates still meet their requirements.

A checkout client may require inventory reservations to be backed by stock.
If the supplier adds backorders, HTTPV can detect that the advertised guarantees
no longer establish that requirement. The client decides whether to block
requests, switch suppliers, or continue.

## Verify an advertised contract

Servers publish certificates through HTTP `OPTIONS` requests. Clients verify
the cryptographic evidence, check compatibility with their local requirements,
and periodically recheck for changes.

HTTPV uses [ZKLean](https://github.com/ZeframLou/zklean)'s public certificate
and verifier APIs. Certificate generation is separate: an HTTPV application
needs a trusted verifier, not a prover or Lean installation.

## Trust model

Clients verify the mathematical claims independently but still trust the server's deployed code and responses to implement its advertised specification. HTTPV cannot detect a server violating that specification while advertising an unchanged certificate. Each client chooses the axioms it accepts and how to handle incompatible or unverifiable dependencies.

## Use the library

```sh
bun add git+https://git@github.com/ZeframLou/httpv.git
```

Create a client with `createHTTPV({backend})`, where `backend` is a trusted
certificate verifier. The [client and server example](examples/upgrades.ts)
uses ZKLean's native verifier and demonstrates compatible and incompatible
inventory API upgrades.

See [SPEC.md](SPEC.md) for the protocol and integration APIs,
[compatibility rules](docs/ENCODING.md), and [Development](docs/DEVELOPMENT.md)
for tests and example generation.
