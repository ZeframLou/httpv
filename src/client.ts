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

/** Every client accepts responses this large (SPEC 4.3). */
const MAX_DISCOVERY_BYTES = 64 * 1024;

/** Plain HTTP is only for a server on this machine. */
const loopback = (host: string) =>
  host === "localhost" || host === "[::1]" || /^127\.\d+\.\d+\.\d+$/.test(host);

/** Read at most `limit` bytes. A failed read is a transport error; content
 * that is too large or not UTF-8 JSON is the server's error. */
async function readJSON(response: Response, limit: number): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for await (const chunk of response.body ?? []) {
      if ((size += chunk.byteLength) > limit)
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
  const maxBytes = options.maxResponseBytes ?? MAX_DISCOVERY_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < MAX_DISCOVERY_BYTES)
    throw new RangeError(
      "maxResponseBytes must be an integer of at least 64 KiB",
    );

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
    const type = response.headers
      .get("content-type")
      ?.split(";")[0]!
      .trim()
      .toLowerCase();
    if (response.status !== 200 || type !== MEDIA_TYPE) {
      await response.body?.cancel();
      // The classification table in SPEC 4.3.
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
    return parseDiscovery(await readJSON(response, maxBytes), name);
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
      // ZKLean rejects requirements with no claims, which would accept any
      // valid certificate.
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
      // Own the dependency: the caller's object may change while discovery awaits.
      dependency = structuredClone(dependency);
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
    dependency = structuredClone(dependency);
    const { interval, timeout = 10_000, onChange } = settings;
    const maxAge = settings.maxAge ?? Math.min(interval + timeout, 0x7fffffff);
    for (const [name, value] of Object.entries({ interval, timeout, maxAge }))
      if (!Number.isInteger(value) || value < 1 || value > 0x7fffffff)
        throw new RangeError(`invalid ${name}`);
    const stopper = new AbortController();
    const stopped = (): Result => ({ status: "unknown", reason: "stopped" });
    let latest: Result | undefined;
    // When the latest result's check started, on the monotonic clock: ages and
    // timeouts must not move when the wall clock is adjusted.
    let latestStart = 0;
    let inflight: Promise<Result> | undefined;
    let timer: Timer | undefined;
    let expiry: Timer | undefined;
    let notified: string | undefined;
    let running: Promise<unknown> | undefined;

    // Verification cannot be cancelled, so a deadline settles the cycle and a
    // result that arrives late, even one that won the race, is discarded. A
    // check abandoned that way still runs, so the next one waits for it: one
    // check at a time, however slowly the verifier answers.
    const cycle = async (): Promise<[Result, number]> => {
      const started = performance.now();
      const checkedAt = Date.now();
      const deadline = AbortSignal.any([
        stopper.signal,
        AbortSignal.timeout(timeout),
      ]);
      const aborted = new Promise<void>((resolve) =>
        deadline.addEventListener("abort", () => resolve(), { once: true }),
      );
      const previous = running;
      const work = (async () => {
        await previous;
        // Abandoned while waiting: never start it.
        if (deadline.aborted) return;
        return check(dependency, { signal: deadline, timeout });
      })();
      running = work;
      const result = await Promise.race([work, aborted]);
      // A result is as old as the request that produced it.
      if (!result || performance.now() - started >= timeout)
        return [{ status: "unknown", reason: "timeout", checkedAt }, started];
      return [{ ...result, checkedAt }, started];
    };

    // Stopping is the caller's own act and is never notified.
    const notify = (result: Result): void => {
      if (stopper.signal.aborted) return;
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

    const age = () => performance.now() - latestStart;

    // Timers can fire late, so freshness is also checked on every read.
    const current = (): Result | undefined => {
      if (stopper.signal.aborted) return stopped();
      if (latest?.status === "verified" && age() >= maxAge)
        return {
          status: "unknown",
          reason: "expired",
          checkedAt: latest.checkedAt!,
        };
      return latest && { ...latest };
    };

    // Notify expiry once maxAge has passed. Timers round and can fire a
    // little early, so re-arm until the deadline really has passed.
    const expire = (): void => {
      const left = maxAge - age();
      if (left > 0) expiry = setTimeout(expire, Math.ceil(left));
      else notify(current()!);
    };

    const refresh = (): Promise<Result> => {
      if (stopper.signal.aborted) return Promise.resolve(stopped());
      inflight ??= cycle().then(([result, started]) => {
        inflight = undefined;
        if (stopper.signal.aborted) return stopped();
        latest = result;
        latestStart = started;
        clearTimeout(timer);
        clearTimeout(expiry);
        // Checks start at a fixed rate, so with the default maxAge a verified
        // result stays current until the next one arrives.
        timer = setTimeout(refresh, Math.max(0, interval - age()));
        if (latest.status === "verified") expire();
        // A result that took longer than maxAge is already expired, and
        // onChange may stop the monitor.
        notify(current()!);
        return current()!;
      });
      return inflight;
    };

    const stop = (): void => {
      stopper.abort();
      clearTimeout(timer);
      clearTimeout(expiry);
    };
    settings.signal?.addEventListener("abort", stop, {
      once: true,
      signal: stopper.signal,
    });
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
