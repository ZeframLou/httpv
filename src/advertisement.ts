import { object, parseCertificate, readModel } from "zklean/encoding";
import { publicContext } from "zklean";
import type { Advertisement } from "./types.ts";

export const DISCOVERY_FORMAT = "httpv/1";

/** The TLS-authenticated entrypoint is separate from the mathematical proof.
 * Its declaration must be part of the certified claim context, not proof-only
 * data or an unrelated definition carried by another part of the model. */
export function parseAdvertisement(value: unknown): Advertisement {
  const data = object(value);
  if (
    Object.keys(data).sort().join(",") !== "certificate,operation" ||
    typeof data.operation !== "string" ||
    !data.operation
  )
    throw new Error("invalid HTTPV advertisement");
  const certificate = parseCertificate(data.certificate);
  const context = publicContext(
    readModel(certificate.specs),
    certificate.specs.claims,
  );
  if (!Object.hasOwn(context.declarations, data.operation))
    throw new Error(
      "advertised entrypoint is outside the certified claim context",
    );
  return { operation: data.operation, certificate };
}
