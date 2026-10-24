/** Each committed certificate proves exactly its freshly checked source model. */
import { createVerifier, parseCertificate } from "zklean";
import { canonical, statement } from "zklean/encoding";
import { models } from "./models.ts";

const { verify } = createVerifier();
for (const model of models) {
  if (!model.certificate) continue;
  const certificate = parseCertificate(
    await Bun.file(model.certificate).json(),
  );
  if (
    canonical(statement(certificate)) !==
    canonical(await Bun.file(model.out).json())
  )
    throw new Error(
      `${model.certificate} differs from its checked source model`,
    );
  const result = await verify(certificate, {
    allowedAxioms: model.axioms,
    axiomPins: await Bun.file(model.policy).json(),
  });
  if (result.status !== "verified")
    throw new Error(`${model.certificate}: ${JSON.stringify(result)}`);
  console.log(`${model.certificate}: verified`);
}
