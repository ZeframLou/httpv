import { MAX_CERTIFICATE_BYTES, readModel } from "zklean/encoding";
import {
  createVerifier,
  declarationIdentity,
  loadRequirements,
  publicContext,
} from "zklean";
import type { Specs } from "zklean";
import {
  bridgeMatches,
  exactMatch,
  operationMatches,
} from "./compatibility.ts";
import {
  DiscoveryError,
  MEDIA_TYPE,
  methodName,
  parseDiscovery,
} from "./protocol.ts";
import type {
  Advertisement,
  ClientOptions,
  Dependency,
  Monitor,
  QueryOptions,
  Reason,
  Requirement,
  Result,
  WatchOptions,
} from "./types.ts";

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
  const maxBytes = options.maxResponseBytes ?? MAX_CERTIFICATE_BYTES;

  /** Fetch the advertisement for one method of a resource. Throws DiscoveryError. */
  async function query(
    url: string,
    { method, allowInsecureHttp, signal }: QueryOptions,
  ): Promise<Advertisement> {
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
        signal: signal ?? AbortSignal.timeout(10_000),
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

  /** Decide whether an advertisement establishes a requirement. */
  async function compare(
    advertisement: Advertisement,
    requirement: Requirement,
  ): Promise<Result> {
    const { certificate } = advertisement;
    const { status, reason, ...identity } = await verify(
      certificate,
      requirement,
    );
    const base = { ...identity, advertisedOperation: advertisement.operation };
    if (status !== "verified")
      return { ...base, status, reason: reason as Reason };

    let specs: Specs;
    try {
      specs = (await loadRequirements(requirement.requirements)).specs;
      const context = publicContext(readModel(specs), specs.claims);
      if (!Object.hasOwn(context.declarations, requirement.operation))
        throw new Error(
          `${requirement.operation} is outside the requirement claims' context`,
        );
    } catch (error) {
      return {
        ...base,
        status: "unknown",
        reason: "invalid-requirements",
        detail: String(error),
      };
    }
    if (!operationMatches(advertisement, specs, requirement.operation))
      return { ...base, status: "incompatible", reason: "operation-mismatch" };
    if (exactMatch(certificate, specs))
      return { ...base, status: "verified", reason: "exact-match" };
    if (!requirement.bridge)
      return {
        ...base,
        status: "incompatible",
        reason: "requirements-not-met",
      };

    // The bridge may assume the remote claims just verified, pinned to their
    // exact remote meaning, plus axioms the client permits.
    const { claims } = certificate.specs;
    const remoteModel = readModel(certificate.specs);
    const bridged = await verify(requirement.bridge, {
      allowedAxioms: [...requirement.allowedAxioms, ...claims],
      axiomPins: {
        ...requirement.axiomPins,
        ...Object.fromEntries(
          claims.map((name) => [name, declarationIdentity(remoteModel, name)]),
        ),
      },
    });
    if (
      bridged.status !== "verified" ||
      !bridgeMatches(certificate, specs, requirement.bridge)
    )
      return {
        ...base,
        status: "unknown",
        reason: "invalid-bridge",
        detail: bridged.detail ?? bridged.reason,
      };
    return { ...base, status: "verified", reason: "bridge" };
  }

  /** Query and compare. Never throws; failures are `unknown` results. */
  async function check(
    dependency: Dependency,
    signal?: AbortSignal,
  ): Promise<Result> {
    try {
      return await compare(
        await query(dependency.url, { ...dependency, signal }),
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
      if (!(value > 0 && value <= 0x7fffffff))
        throw new RangeError(`invalid ${name}`);
    const stopper = new AbortController();
    const stopped = (): Result => ({ status: "unknown", reason: "stopped" });
    let latest: Result | undefined;
    let inflight: Promise<Result> | undefined;
    let timer: Timer | undefined;
    let notified: string | undefined;

    // Verification cannot be cancelled, so a deadline settles the cycle instead
    // and any late result is discarded.
    const cycle = (): Promise<Result> => {
      const deadline = AbortSignal.any([
        stopper.signal,
        AbortSignal.timeout(timeout),
      ]);
      const aborted = new Promise<Result>((resolve) =>
        deadline.addEventListener(
          "abort",
          () =>
            resolve(
              stopper.signal.aborted
                ? stopped()
                : { status: "unknown", reason: "timeout" },
            ),
          { once: true },
        ),
      );
      return Promise.race([check(dependency, deadline), aborted]);
    };

    const notify = (result: Result): void => {
      const { status, reason, certificateId, modelId, advertisedOperation } =
        result;
      const key = JSON.stringify([
        status,
        reason,
        certificateId,
        modelId,
        advertisedOperation,
      ]);
      if (key === notified) return;
      notified = key;
      try {
        onChange?.({ ...result });
      } catch (error) {
        reportError(error);
      }
    };

    const refresh = (): Promise<Result> => {
      if (stopper.signal.aborted) return Promise.resolve(stopped());
      inflight ??= cycle().then((result) => {
        inflight = undefined;
        if (stopper.signal.aborted) return stopped();
        latest = { ...result, checkedAt: Date.now() };
        clearTimeout(timer);
        timer = setTimeout(refresh, interval);
        notify(latest);
        return { ...latest };
      });
      return inflight;
    };

    const current = (): Result | undefined => {
      if (stopper.signal.aborted) return stopped();
      if (
        latest?.status === "verified" &&
        Date.now() - latest.checkedAt! >= maxAge
      )
        return {
          status: "unknown",
          reason: "expired",
          checkedAt: latest.checkedAt!,
        };
      return latest && { ...latest };
    };

    const stop = (): void => {
      stopper.abort();
      clearTimeout(timer);
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
