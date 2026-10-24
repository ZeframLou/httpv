/** Re-check every Lean model with the installed ZKLean CLI and rewrite its public model. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { models } from "./models.ts";
import { runZKLean } from "./zklean.ts";

const temporary = await mkdtemp(join(tmpdir(), "httpv-fixtures-"));
try {
  for (const [index, model] of models.entries()) {
    const exported = join(temporary, `${index}.ndjson`);
    const claims = model.claims.join(",");
    await runZKLean([
      "export",
      "--project",
      model.project,
      "--module",
      model.module,
      "--claims",
      claims,
      "--out",
      exported,
    ]);
    await runZKLean([
      model.requirements ? "requirements" : "check",
      "--export",
      exported,
      "--claims",
      claims,
      "--axioms",
      model.axioms.join(","),
      "--axiom-policy",
      model.policy,
      "--out",
      model.out,
    ]);
  }
} finally {
  await rm(temporary, { recursive: true });
}
