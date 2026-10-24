import { object, parseCertificate, readModel } from "zklean/encoding";
import { publicContext } from "zklean";
import type { Advertisement } from "./types.ts";

export const MEDIA_TYPE = "application/httpv+json";
export const FORMAT = "httpv/1";

export class DiscoveryError extends Error {
  constructor(
    readonly reason:
      | "unavailable"
      | "missing-certificate"
      | "invalid-advertisement",
    message: string,
  ) {
    super(message);
  }
}

/** Fetch normalizes standard methods; extension methods stay case-sensitive. */
export function methodName(method: string): string {
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(method))
    throw new Error("invalid HTTP method");
  const upper = method.toUpperCase();
  return ["DELETE", "GET", "HEAD", "OPTIONS", "POST", "PUT"].includes(upper)
    ? upper
    : method;
}

/** Versioned envelopes are closed: a new field needs a new format. */
function exactFields(
  value: unknown,
  fields: string[],
): Record<string, unknown> {
  const data = object(value);
  if (Object.keys(data).sort().join() !== fields.join())
    throw new Error(`expected exactly ${fields.join(", ")}`);
  return data;
}

/** The entrypoint must be a declaration the certified claims depend on. */
export function parseAdvertisement(value: unknown): Advertisement {
  const data = exactFields(value, ["certificate", "operation"]);
  if (typeof data.operation !== "string" || !data.operation)
    throw new Error("operation must be a nonempty string");
  const certificate = parseCertificate(data.certificate);
  const context = publicContext(
    readModel(certificate.specs),
    certificate.specs.claims,
  );
  if (!Object.hasOwn(context.declarations, data.operation))
    throw new Error("operation is outside the certified claim context");
  return { operation: data.operation, certificate };
}

export function encodeDiscovery(contracts: Record<string, Advertisement>) {
  return { format: FORMAT, contracts };
}

export function parseDiscovery(value: unknown, method: string): Advertisement {
  let contracts: Record<string, unknown>;
  try {
    const body = exactFields(value, ["contracts", "format"]);
    if (body.format !== FORMAT) throw new Error("unsupported format");
    contracts = object(body.contracts);
  } catch (error) {
    throw new DiscoveryError("invalid-advertisement", String(error));
  }
  if (!Object.hasOwn(contracts, method))
    throw new DiscoveryError(
      "missing-certificate",
      `no contract for ${method}`,
    );
  try {
    return parseAdvertisement(contracts[method]);
  } catch (error) {
    throw new DiscoveryError("invalid-advertisement", String(error));
  }
}
