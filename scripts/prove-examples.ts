/** Generate the demo's certificates offline with the independently installed CLI. */
import { examples } from "./export-examples.ts";
import { runZKLean } from "./zklean.ts";

const timeout = process.env.ZKLEAN_PROVE_TIMEOUT;

for (const example of examples.filter((entry) =>
  ["v1", "v2", "v3", "bridge"].includes(entry.file),
)) {
  console.log(`Proving ${example.module} locally…`);
  await runZKLean([
    "prove",
    "--project",
    "examples/lean",
    "--module",
    example.module,
    "--claims",
    example.claims.join(","),
    "--axioms",
    example.axioms.join(","),
    "--axiom-policy",
    "examples/axioms.json",
    ...(timeout ? ["--timeout", timeout] : []),
    "--out",
    `examples/generated/${example.file}.json`,
  ]);
}
await runZKLean([
  "requirements",
  "--project",
  "examples/lean",
  "--module",
  "Requirements",
  "--claims",
  "Client.stock_conserved",
  "--out",
  "examples/generated/requirements.json",
]);
