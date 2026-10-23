import { readModel } from "zklean/encoding";
import { contextMatches, publicContext } from "zklean";
import type { Certificate, Specs } from "zklean";
export { loadRequirements } from "zklean";

/** Match mathematical contexts, ignoring bound-variable display annotations. */
export function exactMatch(remote: Certificate, requirements: Specs): boolean {
  return (
    requirements.claims.every((name) => remote.specs.claims.includes(name)) &&
    contextMatches(
      readModel(remote.specs),
      publicContext(readModel(requirements), requirements.claims),
    )
  );
}

/** Each assumed remote claim retains its complete authenticated context.
 * Different versions of an operation need distinct names in a bridge. */
export function validBridge(
  remote: Certificate,
  requirements: Specs,
  bridge: Certificate,
): boolean {
  const model = readModel(bridge.specs);
  const remoteModel = readModel(remote.specs);
  // Even an independently proved requirement must not reinterpret an operation
  // that the remote model defines under the same name. Extra remote declarations
  // are permitted; every declaration shared with the bridge must agree.
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
