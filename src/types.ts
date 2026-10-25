import type {
  Certificate,
  Requirements,
  VerificationResult as CertificateResult,
  VerifierOptions,
} from "zklean";
export type { Certificate, ProofBackend, Requirements } from "zklean";

export type Status = "verified" | "incompatible" | "unknown";
export type Reason =
  // verified
  | "exact-match"
  // incompatible
  | "operation-mismatch"
  | "requirements-not-met"
  // unknown: certificate checks, discovery, local configuration, monitoring
  | Exclude<CertificateResult["reason"], "valid">
  | "unavailable"
  | "missing-certificate"
  | "invalid-advertisement"
  | "invalid-requirements"
  | "timeout"
  | "expired"
  | "stopped";

export interface Result {
  status: Status;
  reason: Reason;
  detail?: string;
  statementId?: string;
  /** Entrypoint the server advertised for this endpoint. */
  advertisedOperation?: string;
  /** Set by monitors. */
  checkedAt?: number;
}

export interface Advertisement {
  readonly operation: string;
  readonly certificate: Certificate;
}

/** What a client's correctness proof assumes about one remote operation. */
export interface Requirement {
  /** The Lean function the endpoint must implement, which the required claims
   * are about. Their identities fix its body; this name fixes the endpoint. */
  operation: string;
  /** A requirements snapshot or the path of its JSON file. */
  requirements: Requirements | string;
  /** Axioms you accept, by name and identity; see zklean's `standardAxioms`. */
  axioms: Readonly<Record<string, string>>;
}

export interface QueryOptions {
  method: string;
  /** HTTP is accepted only when explicitly enabled for local development. */
  allowInsecureHttp?: boolean;
  signal?: AbortSignal | undefined;
  /** Milliseconds before discovery is abandoned. Default 10 s. */
  timeout?: number | undefined;
}

export interface Dependency
  extends Requirement,
    Omit<QueryOptions, "signal" | "timeout"> {
  url: string;
}

export interface WatchOptions {
  interval: number;
  /** Bound on one check, including verification. Default 10 s. */
  timeout?: number;
  /** Age after which a verified result stops gating requests. Default interval + timeout. */
  maxAge?: number;
  /** Called on the first result, on expiry, and whenever status, reason or identity changes. */
  onChange?(result: Result): void;
  signal?: AbortSignal;
}

export interface Monitor {
  refresh(): Promise<Result>;
  stop(): void;
  readonly current: Result | undefined;
  /** Throw unless the latest result is verified and younger than `maxAge`. */
  requireVerified(): Result;
}

export interface ClientOptions extends VerifierOptions {
  fetch?: (input: URL, init: RequestInit) => Promise<Response>;
  maxResponseBytes?: number;
}

export type Handler = (request: Request) => Response | Promise<Response>;
export type Source =
  | Advertisement
  | (() => Advertisement | Promise<Advertisement>);
export interface ServeOptions {
  routes: Record<string, Source>;
  fetch: Handler;
}
