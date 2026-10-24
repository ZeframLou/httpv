import type {
  Certificate,
  Requirements,
  VerifyOptions,
  VerifierOptions,
  VerificationResult as CertificateVerificationResult,
} from "zklean";
export type {
  Certificate,
  Requirements,
  ProofBackend,
  VerifyOptions,
} from "zklean";

export type Status = CertificateVerificationResult["status"] | "incompatible";
export type Reason =
  | CertificateVerificationResult["reason"]
  | "exact-match"
  | "derivation"
  | "requirements-not-met"
  | "unavailable"
  | "missing-certificate"
  | "requirements-unavailable"
  | "invalid-operation-binding"
  | "invalid-advertisement"
  | "invalid-options"
  | "context-unavailable"
  | "operation-mismatch"
  | "missing-derivation"
  | "invalid-derivation";
export type MonitorReason =
  | "expired"
  | "stopped"
  | "timeout"
  | "callback-error";
export interface VerificationResult
  extends Omit<CertificateVerificationResult, "status" | "reason"> {
  status: Status;
  reason: Reason | MonitorReason;
  checkedAt?: number;
  /** Entrypoint currently associated with this endpoint by discovery. */
  advertisedOperation?: string;
}
export interface Advertisement {
  readonly operation: string;
  readonly certificate: Certificate;
}
export interface CompatibilityOptions extends VerifyOptions {
  advertisement: unknown;
  requirements: Requirements | string;
  /** Expected endpoint entrypoint in the reviewed local requirement context. */
  operation: string;
  derivation?: unknown;
  /** Exact comparison is decidable. Semantic checking requires a derivation. */
  mode?: "exact" | "implication";
}
export interface QueryOptions {
  method: string;
  signal?: AbortSignal;
  timeout?: number;
  /** HTTP is accepted only when explicitly enabled for local development. */
  allowInsecureHttp?: boolean;
}
export interface WatchOptions extends QueryOptions {
  url: string;
  requirements: Requirements | string;
  operation: string;
  allowedAxioms?: readonly string[];
  axiomPins?: Readonly<Record<string, string>>;
  interval: number;
  /** Maximum age of an accepted check; defaults to interval + timeout. */
  maxAge?: number;
  derivation?: unknown;
  mode?: "exact" | "implication";
  /** Synchronous state notification. Await async side effects outside this hook. */
  onChange?(result: VerificationResult): undefined;
  onError?(error: unknown): void | Promise<void>;
}
export interface Monitor {
  stop(): void;
  refresh(): Promise<VerificationResult>;
  readonly current: VerificationResult | undefined;
  /** Throw unless the monitor currently has a fresh verified result. */
  requireVerified(): VerificationResult;
}
export type Handler = (request: Request) => Response | Promise<Response>;
export interface ServeOptions {
  routes: Record<
    string,
    | { operation: string; certificate: Certificate | string }
    | (() => Advertisement | Promise<Advertisement>)
  >;
  fetch: Handler;
}
export interface ClientOptions extends VerifierOptions {
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  maxResponseBytes?: number;
}
