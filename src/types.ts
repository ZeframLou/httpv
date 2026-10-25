import type {
  Certificate,
  Requirements,
  VerificationResult as CertificateResult,
  VerifierOptions,
} from "zklean";
export type { Certificate, ProofBackend, Requirements } from "zklean";

export type Status = "verified" | "incompatible" | "unknown";
export type DiscoveryReason =
  | "unavailable"
  | "missing-certificate"
  | "invalid-advertisement";
export type Reason =
  // verified
  | "exact-match"
  // incompatible
  | "requirements-not-met"
  // unknown: certificate checks, discovery, local configuration
  | Exclude<CertificateResult["reason"], "valid">
  | DiscoveryReason
  | "invalid-requirements";

export interface Result {
  status: Status;
  reason: Reason;
  detail?: string;
  statementId?: string;
}

/** What a client's correctness proof assumes about one endpoint. */
export interface Requirement {
  /** A requirements snapshot or the path of its JSON file. */
  requirements: Requirements | string;
  /** Axioms you accept, by name and identity; see zklean's `standardAxioms`. */
  axioms: Readonly<Record<string, string>>;
}

export interface QueryOptions {
  method: string;
  /** Allow plain HTTP to `localhost` or a loopback address, for development. */
  allowInsecureHttp?: boolean | undefined;
  signal?: AbortSignal | undefined;
  /** Milliseconds before discovery is abandoned. Default 10 s. */
  timeout?: number | undefined;
}

export interface Dependency
  extends Requirement,
    Omit<QueryOptions, "signal" | "timeout"> {
  url: string;
}

export interface ClientOptions extends VerifierOptions {
  fetch?: (input: URL, init: RequestInit) => Promise<Response>;
}

export type Handler = (request: Request) => Response | Promise<Response>;
export type Source = Certificate | (() => Certificate | Promise<Certificate>);
export interface ServeOptions {
  routes: Record<string, Source>;
  fetch: Handler;
}
