# Test fixtures

`*.statement.json` are public models checked by the Lean kernel through
ZKLean, without proofs. The policy tests sign them with a test-only backend.
`lean/` holds their sources; `unit/` holds the models of the example's real
certificates. `requirements.json` is the client requirement for `lean/`.

| Fixture              | Case                                                         |
| -------------------- | ------------------------------------------------------------ |
| `v1`                 | A stock-conserving reservation operation.                    |
| `v2`                 | A compatible upgrade that adds a claim.                      |
| `v3`                 | Backorders, under the same theorem name.                     |
| `bridge`             | Derives the client requirement from `v1`'s claim.            |
| `independent`        | Proves the requirement without assuming any remote claim.    |
| `changed-definition` | Same theorem statement, redefined operation.                 |
| `renamed-operation`  | The operation under a different name.                        |
| `weakened-claim`     | Same operation, weaker theorem under the same name.          |

Regenerate them with `bun run fixtures`.
