/** Regenerate the example's requirements and certificates. Each proof takes
 * minutes and writes the certificate beside the export it was proved from. */
import { certificates, requirements, source, sourceURL } from "./models.ts";
import { runZKLean } from "./zklean.ts";

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
    ...["--source", sourceURL(model.out)],
    ...(timeout ? ["--timeout", timeout] : []),
    "--out",
    model.out,
  ]);
}
