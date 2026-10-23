/** Regenerate public model test vectors with the real Lean checker. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { examples } from "./export-examples.ts";
import { runZKLean } from "./zklean.ts";

const temporary = await mkdtemp(join(tmpdir(), "httpv-fixtures-"));
try {
  for (const example of examples) {
    const exported = join(temporary, `${example.file}.ndjson`);
    await runZKLean([
      "export",
      "--project",
      "examples/lean",
      "--module",
      example.module,
      "--claims",
      example.claims.join(","),
      "--out",
      exported,
    ]);
    await runZKLean([
      example.file === "requirements" ? "requirements" : "check",
      "--export",
      exported,
      "--claims",
      example.claims.join(","),
      "--axioms",
      example.axioms.join(","),
      "--out",
      `tests/fixtures/${example.file}${example.file === "requirements" ? "" : ".statement"}.json`,
    ]);
  }
} finally {
  await rm(temporary, { recursive: true });
}
