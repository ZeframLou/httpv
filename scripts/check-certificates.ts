/** Re-check the example's Lean sources and confirm every committed artifact
 * matches them: requirements, the bridge policy, and each certificate's
 * statement and proof. */
import { createVerifier, parseCertificate } from "zklean";
import { canonical, statement } from "zklean/encoding";
import {
  axiomFlags,
  bridgePolicy,
  certificates,
  expectedBridgePolicy,
  generateRequirements,
  requirements,
  source,
} from "./models.ts";
import { runZKLean } from "./zklean.ts";

function same(path: string, actual: unknown, expected: unknown) {
  if (canonical(actual) !== canonical(expected))
    throw new Error(`${path} differs from its Lean source`);
  console.log(`${path}: matches its source`);
}

const policy = await Bun.file(bridgePolicy).json();
same(bridgePolicy, policy, await expectedBridgePolicy());
same(
  requirements.out,
  await Bun.file(requirements.out).json(),
  await generateRequirements(requirements),
);

const { verify } = createVerifier();
for (const model of certificates) {
  const certificate = parseCertificate(await Bun.file(model.out).json());
  const checked = JSON.parse(
    await runZKLean(["check", ...source(model), ...axiomFlags(model)]),
  );
  same(model.out, statement(certificate), checked);
  const result = await verify(certificate, {
    axioms: model.axioms.length ? policy : {},
  });
  if (result.status !== "verified")
    throw new Error(`${model.out}: ${JSON.stringify(result)}`);
  console.log(`${model.out}: proof verified`);
}
