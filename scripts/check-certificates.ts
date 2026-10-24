/** Bind committed cryptographic fixtures to freshly checked source models. */
import { createVerifier, parseCertificate } from "zklean";
import { canonical, statement } from "zklean/encoding";
import { unitExamples } from "./models.ts";

const verifier = createVerifier();
for (const example of unitExamples.filter((entry) => entry.certificate)) {
  const certificate = parseCertificate(
    await Bun.file(example.certificatePath!).json(),
  );
  const checked = await Bun.file(example.modelPath).json();
  if (canonical(statement(certificate)) !== canonical(checked))
    throw new Error(
      `${example.file}: certificate differs from the source-checked model`,
    );
  const result = await verifier.verify(certificate, {
    allowedAxioms: example.axioms,
    axiomPins: await Bun.file(example.policy).json(),
  });
  if (result.status !== "verified")
    throw new Error(`${example.file}: ${JSON.stringify(result)}`);
  console.log(`${example.file}: real proof matches the checked source model`);
}
