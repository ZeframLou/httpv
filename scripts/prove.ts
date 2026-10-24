/** Regenerate the example's Groth16 certificates. Each proof takes hours. */
import { models } from "./models.ts";
import { runZKLean } from "./zklean.ts";

const timeout = process.env.ZKLEAN_PROVE_TIMEOUT;
for (const model of models) {
  if (!model.certificate) continue;
  console.log(`Proving ${model.project}/${model.module}…`);
  await runZKLean([
    "prove",
    "--project",
    model.project,
    "--module",
    model.module,
    "--claims",
    model.claims.join(","),
    "--axioms",
    model.axioms.join(","),
    "--axiom-policy",
    model.policy,
    ...(timeout ? ["--timeout", timeout] : []),
    "--out",
    model.certificate,
  ]);
}
