import { object, parseCertificate } from "zklean/encoding";
import type { Certificate } from "./types.ts";

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

/** Each method of a resource has its own certificate, so a change to one
 * endpoint's certificate leaves its siblings' clients undisturbed. */
export function encodeDiscovery(certificates: Record<string, Certificate>) {
  return { format: FORMAT, certificates };
}

export function parseDiscovery(value: unknown, method: string): Certificate {
  let certificates: Record<string, unknown>;
  try {
    const body = exactFields(value, ["certificates", "format"]);
    if (body.format !== FORMAT) throw new Error("unsupported format");
    certificates = object(body.certificates);
  } catch (error) {
    throw new DiscoveryError("invalid-advertisement", String(error));
  }
  if (!Object.hasOwn(certificates, method))
    throw new DiscoveryError(
      "missing-certificate",
      `no certificate for ${method}`,
    );
  try {
    return parseCertificate(certificates[method]);
  } catch (error) {
    throw new DiscoveryError("invalid-advertisement", String(error));
  }
}
