/** Regenerate the example's requirements, bridge policy and certificates.
 * Each proof takes hours and writes the certificate and its source export. */
import {
  axiomFlags,
  bridgePolicy,
  certificates,
  expectedBridgePolicy,
  requirements,
  source,
  sourceURL,
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
    ...["--source", sourceURL(model.out)],
    ...(timeout ? ["--timeout", timeout] : []),
    "--out",
    model.out,
  ]);
}
