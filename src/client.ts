import { createVerifier, loadRequirements, satisfies } from "zklean";
import type { Requirements } from "zklean";
import { identified } from "zklean/encoding";
import {
  DiscoveryError,
  MEDIA_TYPE,
  methodName,
  parseDiscovery,
} from "./protocol.ts";
import type {
  Certificate,
  ClientOptions,
  Dependency,
  QueryOptions,
  Requirement,
  Result,
} from "./types.ts";

/** Every client accepts responses this large (SPEC 2.3), and reads no more. */
const MAX_DISCOVERY_BYTES = 64 * 1024;

/** SPEC 4: never accept these, whatever the caller lists. */
const UNSAFE_AXIOMS = ["sorryAx", "Lean.ofReduceBool", "Lean.trustCompiler"];

/** Plain HTTP is only for a server on this machine. */
const loopback = (host: string) =>
  host === "localhost" || host === "[::1]" || /^127\.\d+\.\d+\.\d+$/.test(host);

/** Read at most MAX_DISCOVERY_BYTES. A failed read is a transport error; content
 * that is too large or not UTF-8 JSON is the server's error. */
async function readJSON(response: Response): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for await (const chunk of response.body ?? []) {
      if ((size += chunk.byteLength) > MAX_DISCOVERY_BYTES)
        throw new DiscoveryError(
          "invalid-advertisement",
          "discovery response too large",
        );
      chunks.push(chunk);
    }
  } catch (error) {
    throw error instanceof DiscoveryError
      ? error
      : new DiscoveryError("unavailable", String(error));
  }
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        Bun.concatArrayBuffers(chunks),
      ),
    );
  } catch (error) {
    throw new DiscoveryError("invalid-advertisement", String(error));
  }
}

/** Each instance holds one trust configuration: verifier backend and transport. */
export function createHTTPV(options: ClientOptions = {}) {
  const transport = options.fetch ?? fetch;
  const { verify } = createVerifier(options);

  /** Fetch the certificate for one method of a resource. Throws DiscoveryError
   * when discovery fails. */
  async function query(
    url: string,
    { method, allowInsecureHttp, signal, timeout = 10_000 }: QueryOptions,
  ): Promise<Certificate> {
    let target: URL;
    let name: string;
    try {
      target = new URL(url);
      name = methodName(method);
    } catch (error) {
      throw new DiscoveryError("unavailable", String(error));
    }
    if (
      target.protocol !== "https:" &&
      !(
        allowInsecureHttp &&
        target.protocol === "http:" &&
        loopback(target.hostname)
      )
    )
      throw new DiscoveryError(
        "unavailable",
        "HTTPV requires HTTPS (allowInsecureHttp permits http to loopback only)",
      );
    if (target.username || target.password || target.href.includes("#"))
      throw new DiscoveryError("unavailable", "invalid discovery URL");
    let response: Response;
    try {
      response = await transport(target, {
        method: "OPTIONS",
        headers: { Accept: MEDIA_TYPE, "Cache-Control": "no-cache" },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.any([
          AbortSignal.timeout(timeout),
          ...(signal ? [signal] : []),
        ]),
      });
    } catch (error) {
      throw new DiscoveryError("unavailable", String(error));
    }
    // A custom transport may ignore `redirect: "error"`.
    if (response.redirected) {
      await response.body?.cancel().catch(() => {});
      throw new DiscoveryError("unavailable", "discovery was redirected");
    }
    const type = response.headers
      .get("content-type")
      ?.split(";")[0]!
      .trim()
      .toLowerCase();
    if (response.status !== 200 || type !== MEDIA_TYPE) {
      await response.body?.cancel().catch(() => {});
      // The classification table in SPEC 2.3.
      const reason =
        type === MEDIA_TYPE && response.ok
          ? "invalid-advertisement"
          : response.ok || [404, 405, 406, 501].includes(response.status)
            ? "missing-certificate"
            : "unavailable";
      throw new DiscoveryError(
        reason,
        `discovery returned ${response.status} ${type ?? "without a media type"}`,
      );
    }
    return parseDiscovery(await readJSON(response), name);
  }

  /** Decide whether a certificate establishes a requirement. */
  async function compare(
    certificate: Certificate,
    requirement: Requirement,
  ): Promise<Result> {
    let requirements: Requirements;
    try {
      // Own the inputs: the caller's objects may change while verification
      // awaits.
      [certificate, requirement] = structuredClone([certificate, requirement]);
      // ZKLean rejects requirements with no claims, which would accept any
      // valid certificate.
      requirements = await loadRequirements(requirement.requirements);
      const unsafe = UNSAFE_AXIOMS.find((name) =>
        Object.hasOwn(identified(requirement.axioms), name),
      );
      if (unsafe) throw new Error(`${unsafe} must never be accepted`);
    } catch (error) {
      return {
        status: "unknown",
        reason: "invalid-requirements",
        detail: String(error),
      };
    }
    const result = await verify(certificate, { axioms: requirement.axioms });
    if (result.status !== "verified") return result;
    const { statementId } = result;
    // Judge exactly the claims ZKLean verified. Same name and identity: the
    // same statement about the same definitions.
    return satisfies(result, requirements)
      ? { statementId, status: "verified", reason: "exact-match" }
      : { statementId, status: "incompatible", reason: "requirements-not-met" };
  }

  /** Query and compare within one deadline. Never throws; failures are
   * `unknown` results. */
  async function check(
    dependency: Dependency,
    { signal, timeout = 10_000 }: Pick<QueryOptions, "signal" | "timeout"> = {},
  ): Promise<Result> {
    try {
      // Own the dependency: the caller's object may change while discovery awaits.
      dependency = structuredClone(dependency);
    } catch (error) {
      return {
        status: "unknown",
        reason: "invalid-requirements",
        detail: String(error),
      };
    }
    let deadline: AbortSignal;
    let certificate: Certificate;
    try {
      deadline = AbortSignal.any([
        AbortSignal.timeout(timeout),
        ...(signal ? [signal] : []),
      ]);
      certificate = await query(dependency.url, {
        ...dependency,
        signal: deadline,
        timeout,
      });
    } catch (error) {
      const reason =
        error instanceof DiscoveryError ? error.reason : "unavailable";
      return { status: "unknown", reason, detail: String(error) };
    }
    // Verification cannot be cancelled, so stop waiting for it at the deadline.
    const expired = new Promise<Result>((resolve) => {
      const stop = () =>
        resolve({
          status: "unknown",
          reason: "verifier-unavailable",
          detail: String(deadline.reason),
        });
      if (deadline.aborted) stop();
      else deadline.addEventListener("abort", stop, { once: true });
    });
    const compared = compare(certificate, dependency).catch(
      (error): Result => ({
        status: "unknown",
        reason: "verifier-unavailable",
        detail: String(error),
      }),
    );
    return Promise.race([compared, expired]);
  }

  return { query, compare, check };
}
