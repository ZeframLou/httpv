/** Re-check the example's Lean sources and confirm every committed artifact
 * matches them: the requirements, and each certificate's statement, proof and
 * source export. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createVerifier, parseCertificate } from "zklean";
import { canonical, statement } from "zklean/encoding";
import {
  certificates,
  exportFile,
  requirements,
  source,
  sourceURL,
} from "./models.ts";
import { runZKLean } from "./zklean.ts";

function same(path: string, actual: unknown, expected: unknown) {
  if (canonical(actual) !== canonical(expected))
    throw new Error(`${path} differs from its Lean source`);
  console.log(`${path}: matches its source`);
}

const { verify } = createVerifier();
const temporary = await mkdtemp(join(tmpdir(), "httpv-check-"));
try {
  const generated = join(temporary, "requirements.json");
  await runZKLean([
    "requirements",
    ...source(requirements),
    "--out",
    generated,
  ]);
  same(
    requirements.out,
    await Bun.file(requirements.out).json(),
    await Bun.file(generated).json(),
  );

  for (const model of certificates) {
    const certificate = parseCertificate(await Bun.file(model.out).json());
    same(
      model.out,
      statement(certificate),
      JSON.parse(await runZKLean(["check", ...source(model)])),
    );
    if (certificate.source !== sourceURL(model.out))
      throw new Error(`${model.out}: unexpected source ${certificate.source}`);
    const result = await verify(certificate, { axioms: {} });
    if (result.status !== "verified")
      throw new Error(`${model.out}: ${JSON.stringify(result)}`);
    // The repository is private, so check the committed export the source
    // URL names instead of downloading it.
    const local = join(temporary, `${model.module}.json`);
    await Bun.write(
      local,
      JSON.stringify({
        ...certificate,
        source: pathToFileURL(resolve(exportFile(model.out))).href,
      }),
    );
    await runZKLean([
      "fetch",
      "--certificate",
      local,
      "--out",
      join(temporary, `${model.module}.ndjson`),
    ]);
    console.log(`${model.out}: proof and source export verified`);
  }
} finally {
  await rm(temporary, { recursive: true });
}
