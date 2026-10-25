import { keys, object, parseCertificate } from "zklean/encoding";
import type { Certificate, DiscoveryReason } from "./types.ts";

export const MEDIA_TYPE = "application/httpv+json";
export const FORMAT = "httpv/1";

export class DiscoveryError extends Error {
  constructor(
    readonly reason: DiscoveryReason,
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

/** The envelope is closed: a new member needs a new version. */
export function parseDiscovery(value: unknown, method: string): Certificate {
  let certificates: Record<string, unknown>;
  try {
    const body = object(value);
    keys(body, ["format", "certificates"]);
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
