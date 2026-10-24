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
  | "bridge"
  // incompatible
  | "operation-mismatch"
  | "requirements-not-met"
  // unknown: certificate checks, discovery, local configuration, monitoring
  | Exclude<CertificateResult["reason"], "valid">
  | "unavailable"
  | "missing-certificate"
  | "invalid-advertisement"
  | "invalid-requirements"
  | "invalid-bridge"
  | "timeout"
  | "expired"
  | "stopped";

export interface Result {
  status: Status;
  reason: Reason;
  detail?: string;
  certificateId?: string;
  modelId?: string;
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
  /** Expected entrypoint; it must occur in the requirement claims' context. */
  operation: string;
  /** A requirements snapshot, its JSON path, or a `.lean` path with a sidecar. */
  requirements: Requirements | string;
  allowedAxioms: readonly string[];
  axiomPins?: Readonly<Record<string, string>>;
  /** Certificate proving the requirements from the remote claims. */
  bridge?: Certificate;
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
