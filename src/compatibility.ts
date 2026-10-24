import { readModel } from "zklean/encoding";
import { contextMatches, publicContext } from "zklean";
import type { Certificate, Specs } from "zklean";
import type { Advertisement } from "./types.ts";

/** Whether `operation` is the advertised entrypoint and means the same thing
 * locally and remotely. Bridges cannot supply or redefine an operation. */
export function operationMatches(
  remote: Advertisement,
  requirements: Specs,
  operation: string,
): boolean {
  const required = publicContext(readModel(requirements), requirements.claims);
  return (
    remote.operation === operation &&
    contextMatches(
      publicContext(
        readModel(remote.certificate.specs),
        remote.certificate.specs.claims,
      ),
      publicContext(required, [operation]),
    )
  );
}

/** Every required claim is certified with an identical resolved context.
 * Binder names and annotations are ignored; extra remote claims are allowed. */
export function exactMatch(remote: Certificate, requirements: Specs): boolean {
  return (
    requirements.claims.every((name) => remote.specs.claims.includes(name)) &&
    contextMatches(
      readModel(remote.specs),
      publicContext(readModel(requirements), requirements.claims),
    )
  );
}

/** A bridge proves the required claims, and every declaration it shares with
 * the remote model agrees, so it cannot reinterpret a remote name. */
export function bridgeMatches(
  remote: Certificate,
  requirements: Specs,
  bridge: Certificate,
): boolean {
  const model = readModel(bridge.specs);
  const remoteModel = readModel(remote.specs);
  const shared = Object.keys(remoteModel.declarations).filter((name) =>
    Object.hasOwn(model.declarations, name),
  );
  return (
    requirements.claims.every((name) => bridge.specs.claims.includes(name)) &&
    contextMatches(
      model,
      publicContext(readModel(requirements), requirements.claims),
    ) &&
    contextMatches(model, publicContext(remoteModel, shared))
  );
}
