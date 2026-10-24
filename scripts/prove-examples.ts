/** Generate the demo's certificates offline with the independently installed CLI. */
import { inventoryExamples, unitExamples } from "./models.ts";
import { runZKLean } from "./zklean.ts";

const timeout = process.env.ZKLEAN_PROVE_TIMEOUT;

const group = process.argv[2] ?? "inventory";
if (!["inventory", "unit"].includes(group))
  throw new Error("usage: bun scripts/prove-examples.ts [inventory|unit]");
const examples = group === "unit" ? unitExamples : inventoryExamples;
for (const example of examples.filter((entry) => entry.certificate)) {
  console.log(`Proving ${example.module} locally…`);
  await runZKLean([
    "prove",
    "--project",
    example.project,
    "--module",
    example.module,
    "--claims",
    example.claims.join(","),
    "--axioms",
    example.axioms.join(","),
    "--axiom-policy",
    example.policy,
    ...(timeout ? ["--timeout", timeout] : []),
    "--out",
    `examples/generated/${example.file}.json`,
  ]);
}
const requirement = examples.find((entry) => entry.requirements)!;
await runZKLean([
  "requirements",
  "--project",
  requirement.project,
  "--module",
  requirement.module,
  "--claims",
  requirement.claims.join(","),
  "--out",
  `examples/generated/${requirement.file}.json`,
]);
