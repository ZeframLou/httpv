/** Regenerate the example's certificates and requirements. Proofs take a long time. */
import {
  axiomFlags,
  bridgePolicy,
  certificates,
  expectedBridgePolicy,
  requirements,
  source,
} from "./models.ts";
import { runZKLean } from "./zklean.ts";

await Bun.write(
  bridgePolicy,
  JSON.stringify(await expectedBridgePolicy(), null, 2) + "\n",
);
await runZKLean([
  "requirements",
  ...source(requirements),
  "--out",
  requirements.out,
]);
const timeout = process.env.ZKLEAN_PROVE_TIMEOUT;
for (const model of certificates) {
  console.log(`Proving ${model.module}…`);
  await runZKLean([
    "prove",
    ...source(model),
    ...axiomFlags(model),
    ...(timeout ? ["--timeout", timeout] : []),
    "--out",
    model.out,
  ]);
}
