import { createVerifier, loadRequirements } from "zklean";
import type { Requirements } from "zklean";
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
  Monitor,
  QueryOptions,
  Reason,
  Requirement,
  Result,
  WatchOptions,
} from "./types.ts";

/** A certificate is a few hundred bytes; an envelope holds one per method. */
const MAX_DISCOVERY_BYTES = 64 * 1024;

const positiveInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) > 0;

async function readText(response: Response, limit: number): Promise<string> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body?.getReader();
  for (
    let next = await reader?.read();
    next && !next.done;
    next = await reader!.read()
  ) {
    size += next.value.byteLength;
    if (size > limit) {
      await reader!.cancel();
      throw new Error("discovery response too large");
    }
    chunks.push(next.value);
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(
    Bun.concatArrayBuffers(chunks),
  );
}

/** Each instance holds one trust configuration: verifier backend and transport. */
export function createHTTPV(options: ClientOptions = {}) {
  const transport = options.fetch ?? fetch;
  const { verify } = createVerifier(options);
  const maxBytes = options.maxResponseBytes ?? MAX_DISCOVERY_BYTES;
  if (!positiveInteger(maxBytes))
    throw new RangeError("invalid maxResponseBytes");

  /** Fetch the certificate for one method of a resource. Throws DiscoveryError
   * when discovery fails. */
  async function query(
    url: string,
    { method, allowInsecureHttp, signal, timeout = 10_000 }: QueryOptions,
  ): Promise<Certificate> {
    const target = new URL(url);
    if (
      target.protocol !== "https:" &&
      !(allowInsecureHttp && target.protocol === "http:")
    )
      throw new DiscoveryError(
        "unavailable",
        "HTTPV requires HTTPS (allowInsecureHttp is for development)",
      );
    if (target.username || target.password || target.hash)
      throw new DiscoveryError("unavailable", "invalid discovery URL");
    const name = methodName(method);
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
    const type = response.headers
      .get("content-type")
      ?.split(";")[0]!
      .trim()
      .toLowerCase();
    if (!response.ok || type !== MEDIA_TYPE) {
      await response.body?.cancel();
      const missing = response.ok || [404, 405, 501].includes(response.status);
      throw new DiscoveryError(
        missing ? "missing-certificate" : "unavailable",
        `discovery returned ${response.status} ${type ?? "without a media type"}`,
      );
    }
    let body: unknown;
    try {
      body = JSON.parse(await readText(response, maxBytes));
    } catch (error) {
      throw new DiscoveryError("invalid-advertisement", String(error));
    }
    return parseDiscovery(body, name);
  }

  /** Decide whether a certificate establishes a requirement. */
  async function compare(
    certificate: Certificate,
    requirement: Requirement,
  ): Promise<Result> {
    // Own the inputs: the caller's objects may change while verification awaits.
    [certificate, requirement] = structuredClone([certificate, requirement]);
    const { status, reason, ...identity } = await verify(certificate, {
      axioms: requirement.axioms,
    });
    if (status !== "verified")
      return { ...identity, status, reason: reason as Reason };

    let requirements: Requirements;
    try {
      requirements = await loadRequirements(requirement.requirements);
    } catch (error) {
      return {
        ...identity,
        status: "unknown",
        reason: "invalid-requirements",
        detail: String(error),
      };
    }
    // Same name and identity: the same statement about the same definitions.
    const met = Object.entries(requirements.claims).every(
      ([name, id]) => certificate.claims[name] === id,
    );
    return met
      ? { ...identity, status: "verified", reason: "exact-match" }
      : { ...identity, status: "incompatible", reason: "requirements-not-met" };
  }

  /** Query and compare. Never throws; failures are `unknown` results. */
  async function check(
    dependency: Dependency,
    options: Pick<QueryOptions, "signal" | "timeout"> = {},
  ): Promise<Result> {
    try {
      return await compare(
        await query(dependency.url, { ...dependency, ...options }),
        dependency,
      );
    } catch (error) {
      const reason =
        error instanceof DiscoveryError ? error.reason : "unavailable";
      return { status: "unknown", reason, detail: String(error) };
    }
  }

  /** Recheck a dependency every `interval`. Gate dependent requests with requireVerified(). */
  function watch(dependency: Dependency, settings: WatchOptions): Monitor {
    const { interval, timeout = 10_000, onChange } = settings;
    const maxAge = settings.maxAge ?? interval + timeout;
    for (const [name, value] of Object.entries({ interval, timeout, maxAge }))
      if (!positiveInteger(value) || value > 0x7fffffff)
        throw new RangeError(`invalid ${name}`);
    const stopper = new AbortController();
    const stopped = (): Result => ({ status: "unknown", reason: "stopped" });
    let latest: Result | undefined;
    let inflight: Promise<Result> | undefined;
    let timer: Timer | undefined;
    let expiry: Timer | undefined;
    let notified: string | undefined;

    // Verification cannot be cancelled, so a deadline settles the cycle and a
    // result that arrives late, even one that won the race, is discarded.
    const cycle = async (): Promise<Result> => {
      const started = Date.now();
      const deadline = AbortSignal.any([
        stopper.signal,
        AbortSignal.timeout(timeout),
      ]);
      const aborted = new Promise<void>((resolve) =>
        deadline.addEventListener("abort", () => resolve(), { once: true }),
      );
      const result = await Promise.race([
        check(dependency, { signal: deadline, timeout }),
        aborted,
      ]);
      if (stopper.signal.aborted) return stopped();
      if (!result || Date.now() - started >= timeout)
        return { status: "unknown", reason: "timeout" };
      return result;
    };

    const notify = (result: Result): void => {
      const { status, reason, statementId } = result;
      const key = JSON.stringify([status, reason, statementId]);
      if (key === notified) return;
      notified = key;
      try {
        onChange?.({ ...result });
      } catch (error) {
        reportError(error);
      }
    };

    const expired = (): Result => ({
      status: "unknown",
      reason: "expired",
      checkedAt: latest!.checkedAt!,
    });

    const refresh = (): Promise<Result> => {
      if (stopper.signal.aborted) return Promise.resolve(stopped());
      inflight ??= cycle().then((result) => {
        inflight = undefined;
        if (stopper.signal.aborted) return stopped();
        latest = { ...result, checkedAt: Date.now() };
        clearTimeout(timer);
        clearTimeout(expiry);
        timer = setTimeout(refresh, interval);
        if (latest.status === "verified")
          expiry = setTimeout(() => notify(expired()), maxAge);
        notify(latest);
        return { ...latest };
      });
      return inflight;
    };

    // Timers can fire late, so freshness is also checked on every read.
    const current = (): Result | undefined => {
      if (stopper.signal.aborted) return stopped();
      if (
        latest?.status === "verified" &&
        Date.now() - latest.checkedAt! >= maxAge
      )
        return expired();
      return latest && { ...latest };
    };

    const stop = (): void => {
      stopper.abort();
      clearTimeout(timer);
      clearTimeout(expiry);
    };
    settings.signal?.addEventListener("abort", stop, { once: true });
    if (settings.signal?.aborted) stop();
    void refresh();

    return {
      refresh,
      stop,
      get current() {
        return current();
      },
      requireVerified() {
        const result = current();
        if (result?.status !== "verified")
          throw new Error(
            `HTTPV dependency is not verified: ${result?.reason ?? "unchecked"}`,
          );
        return result;
      },
    };
  }

  return { query, compare, check, watch };
}
