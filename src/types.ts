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
  | "missing-derivation"
  | "invalid-derivation";
export interface VerificationResult
  extends Omit<CertificateVerificationResult, "status" | "reason"> {
  status: Status;
  reason: Reason;
}
export interface CompatibilityOptions extends VerifyOptions {
  certificate: unknown;
  requirements: Requirements | string;
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
  allowedAxioms?: readonly string[];
  interval: number;
  derivation?: unknown;
  mode?: "exact" | "implication";
  onChange(result: VerificationResult): void | Promise<void>;
  onError?(error: unknown): void | Promise<void>;
}
export interface Monitor {
  stop(): void;
  refresh(): Promise<VerificationResult>;
  readonly current: VerificationResult | undefined;
}
export type Handler = (request: Request) => Response | Promise<Response>;
export interface ServeOptions {
  routes: Record<
    string,
    Certificate | string | (() => Certificate | Promise<Certificate>)
  >;
  fetch: Handler;
}
export interface ClientOptions extends VerifierOptions {
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  maxResponseBytes?: number;
}
