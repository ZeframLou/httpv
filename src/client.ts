import {
  Cache,
  MAX_CERTIFICATE_BYTES,
  canonical,
  modelId,
  object,
  parseCertificate,
} from "zklean/encoding";
import { createVerifier, declarationIdentity } from "zklean";
import { readModel } from "zklean/encoding";
import {
  exactMatch,
  loadRequirements,
  operationBinding,
  validBridge,
} from "./compatibility.ts";
import { discoveryHandler, MEDIA_TYPE, methodName } from "./server.ts";
import { DISCOVERY_FORMAT, parseAdvertisement } from "./advertisement.ts";
import type {
  Certificate,
  Advertisement,
  ClientOptions,
  CompatibilityOptions,
  Monitor,
  QueryOptions,
  ServeOptions,
  VerificationResult,
  WatchOptions,
} from "./types.ts";

export class DiscoveryError extends Error {
  constructor(
    readonly reason:
      | "unavailable"
      | "missing-certificate"
      | "invalid-advertisement",
    message: string,
  ) {
    super(message);
  }
}

/** Instances scope all trust configuration and caches to one application. */
export function createHTTPV(options: ClientOptions = {}) {
  const transport = options.fetch ?? globalThis.fetch;
  const { verify } = createVerifier(options);
  const compatible = new Cache<boolean>(options.cacheSize ?? 128);
  const maxBytes = options.maxResponseBytes ?? MAX_CERTIFICATE_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
    throw new Error("invalid response limit");

  async function query(
    url: string,
    queryOptions: QueryOptions,
  ): Promise<Advertisement> {
    const target = new URL(url);
    if (
      target.protocol !== "https:" &&
      !(target.protocol === "http:" && queryOptions.allowInsecureHttp)
    ) {
      throw new DiscoveryError(
        "unavailable",
        "HTTPV requires HTTPS (allowInsecureHttp is for development)",
      );
    }
    if (target.username || target.password || target.hash)
      throw new DiscoveryError("unavailable", "invalid discovery URL");
    const method = methodName(queryOptions.method);
    const timeout = queryOptions.timeout ?? 10_000;
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 0x7fffffff)
      throw new Error("invalid timeout");
    const signal = AbortSignal.any([
      AbortSignal.timeout(timeout),
      ...(queryOptions.signal ? [queryOptions.signal] : []),
    ]);
    try {
      const response = await transport(target, {
        method: "OPTIONS",
        headers: { Accept: MEDIA_TYPE, "Cache-Control": "no-cache" },
        cache: "no-store",
        redirect: "error",
        signal,
      });
      if (
        response.status === 404 ||
        response.status === 405 ||
        response.status === 501
      ) {
        await response.body?.cancel();
        throw new DiscoveryError(
          "missing-certificate",
          `discovery returned ${response.status}`,
        );
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new DiscoveryError(
          "unavailable",
          `discovery returned ${response.status}`,
        );
      }
      if (
        response.headers
          .get("content-type")
          ?.split(";")[0]
          ?.trim()
          .toLowerCase() !== MEDIA_TYPE
      ) {
        await response.body?.cancel();
        throw new DiscoveryError(
          "missing-certificate",
          "HTTPV media type missing",
        );
      }
      const reader = response.body?.getReader();
      if (!reader)
        throw new DiscoveryError(
          "invalid-advertisement",
          "empty discovery body",
        );
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maxBytes)
            throw new DiscoveryError(
              "invalid-advertisement",
              "discovery response too large",
            );
          chunks.push(value);
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      let body: Record<string, unknown>;
      try {
        body = object(
          JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(
              Buffer.concat(chunks),
            ),
          ),
        );
      } catch {
        throw new DiscoveryError(
          "invalid-advertisement",
          "invalid discovery JSON",
        );
      }
      let contracts: Record<string, unknown>;
      try {
        if (
          body.format !== DISCOVERY_FORMAT ||
          Object.keys(body).sort().join(",") !== "contracts,format"
        )
          throw new Error("unsupported discovery format");
        contracts = object(body.contracts);
      } catch {
        throw new DiscoveryError(
          "invalid-advertisement",
          "invalid contracts map or discovery format",
        );
      }
      if (!Object.hasOwn(contracts, method))
        throw new DiscoveryError(
          "missing-certificate",
          `no certificate for ${method}`,
        );
      try {
        return parseAdvertisement(contracts[method]);
      } catch (error) {
        throw new DiscoveryError("invalid-advertisement", String(error));
      }
    } catch (error) {
      if (error instanceof DiscoveryError) throw error;
      throw new DiscoveryError("unavailable", String(error));
    }
  }

  async function checkCompatibility(
    input: CompatibilityOptions,
  ): Promise<VerificationResult> {
    if (!input || !Array.isArray(input.allowedAxioms))
      return { status: "unknown", reason: "invalid-options" };
    let request: CompatibilityOptions;
    try {
      request = {
        advertisement: input.advertisement,
        operation: input.operation,
        requirements: structuredClone(input.requirements),
        allowedAxioms: [...input.allowedAxioms],
        ...(input.axiomPins === undefined
          ? {}
          : { axiomPins: structuredClone(input.axiomPins) }),
        ...(input.derivation === undefined
          ? {}
          : { derivation: structuredClone(input.derivation) }),
        ...(input.mode === undefined ? {} : { mode: input.mode }),
      };
    } catch (error) {
      return {
        status: "unknown",
        reason: "invalid-options",
        detail: String(error),
      };
    }
    try {
      return await evaluateCompatibility(request);
    } catch (error) {
      return {
        status: "unknown",
        reason: "context-unavailable",
        detail: String(error),
      };
    }
  }

  async function evaluateCompatibility(
    input: CompatibilityOptions,
  ): Promise<VerificationResult> {
    if (typeof input.operation !== "string" || !input.operation)
      return { status: "unknown", reason: "invalid-operation-binding" };
    if (
      input.mode !== undefined &&
      !["exact", "implication"].includes(input.mode)
    )
      return { status: "unknown", reason: "invalid-options" };
    const operation = input.operation;
    let advertisement: Advertisement;
    try {
      advertisement = parseAdvertisement(input.advertisement);
    } catch (error) {
      return {
        status: "unknown",
        reason: "invalid-advertisement",
        detail: String(error),
      };
    }
    const certificate = advertisement.certificate;
    const result = {
      ...(await verify(certificate, input)),
      advertisedOperation: advertisement.operation,
    };
    if (result.status !== "verified") return result;
    let requirements;
    try {
      requirements = await loadRequirements(input.requirements);
    } catch (error) {
      return {
        ...result,
        status: "unknown",
        reason: "requirements-unavailable",
        detail: String(error),
      };
    }
    const bindingError = operationBinding(
      advertisement,
      requirements.specs,
      operation,
    );
    if (bindingError)
      return {
        ...result,
        status:
          input.mode === "exact" && bindingError === "operation-mismatch"
            ? "incompatible"
            : "unknown",
        reason: bindingError,
      };
    const key = canonical({
      remote: result.modelId,
      required: modelId(requirements.specs),
      operation,
      advertisedOperation: advertisement.operation,
    });
    if (compatible.get(key) || exactMatch(certificate, requirements.specs)) {
      compatible.set(key, true);
      return { ...result, reason: "exact-match" };
    }
    if (input.mode === "exact")
      return {
        ...result,
        status: "incompatible",
        reason: "requirements-not-met",
      };
    if (input.derivation === undefined) {
      return { ...result, status: "unknown", reason: "missing-derivation" };
    }
    // A derivation may assume only client-permitted axioms and guarantees that
    // were independently authenticated in the remote certificate above.
    let bridge: Certificate;
    try {
      bridge = parseCertificate(input.derivation);
    } catch {
      return { ...result, status: "unknown", reason: "invalid-derivation" };
    }
    const remoteModel = readModel(certificate.specs);
    const bridgeResult = await verify(bridge, {
      allowedAxioms: [...input.allowedAxioms, ...certificate.specs.claims],
      axiomPins: {
        ...input.axiomPins,
        ...Object.fromEntries(
          certificate.specs.claims.map((name) => [
            name,
            declarationIdentity(remoteModel, name),
          ]),
        ),
      },
    });
    if (bridgeResult.status !== "verified")
      return { ...result, status: "unknown", reason: "invalid-derivation" };
    if (!validBridge(certificate, requirements.specs, bridge))
      return { ...result, status: "unknown", reason: "invalid-derivation" };
    // The certificate cache avoids repeated cryptography. The inexpensive context
    // comparison is repeated to keep derivation and axiom policies independent.
    return { ...result, reason: "derivation" };
  }

  function watch(input: WatchOptions): Monitor {
    const timeout = input.timeout ?? 10_000;
    const maxAge = input.maxAge ?? input.interval + timeout;
    for (const [name, value] of Object.entries({
      interval: input.interval,
      timeout,
      maxAge,
    }))
      if (!Number.isSafeInteger(value) || value < 1 || value > 0x7fffffff)
        throw new Error(`invalid ${name}`);
    const options = {
      ...input,
      requirements:
        typeof input.requirements === "string"
          ? input.requirements
          : structuredClone(input.requirements),
      allowedAxioms: [...(input.allowedAxioms ?? [])],
      axiomPins: { ...input.axiomPins },
      ...(input.derivation === undefined
        ? {}
        : { derivation: structuredClone(input.derivation) }),
    };
    const controller = new AbortController();
    const signal = AbortSignal.any([
      controller.signal,
      ...(input.signal ? [input.signal] : []),
    ]);
    let current: VerificationResult | undefined;
    let inflight: Promise<VerificationResult> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    let stopped = signal.aborted;
    let lastEvent: string | undefined;

    const onError = (error: unknown) => {
      try {
        void Promise.resolve(options.onError?.(error)).catch(() => {});
      } catch {
        /* Diagnostics cannot interrupt monitoring. */
      }
    };
    const publish = (result: VerificationResult): void => {
      if (stopped) return;
      if (expiry) clearTimeout(expiry);
      current = { ...result, checkedAt: Date.now() };
      if (current.status === "verified")
        expiry = setTimeout(
          () => publish({ status: "unknown", reason: "expired" }),
          maxAge,
        );
      const event = canonical({
        status: result.status,
        reason: result.reason,
        certificateId: result.certificateId ?? null,
        modelId: result.modelId ?? null,
        advertisedOperation: result.advertisedOperation ?? null,
      });
      if (event === lastEvent) return;
      lastEvent = event;
      try {
        const returned: unknown = options.onChange?.(structuredClone(current));
        if (
          returned &&
          typeof (returned as PromiseLike<unknown>).then === "function"
        ) {
          void Promise.resolve(returned).catch(onError);
          current = {
            status: "unknown",
            reason: "callback-error",
            checkedAt: Date.now(),
          };
          stop(false);
          onError(
            new Error(
              "onChange must be synchronous; gate requests with requireVerified()",
            ),
          );
        }
      } catch (error) {
        onError(error);
      }
    };
    const stop = (invalidate = true): void => {
      if (stopped) return;
      stopped = true;
      if (timer) clearTimeout(timer);
      if (expiry) clearTimeout(expiry);
      if (invalidate)
        current = {
          status: "unknown",
          reason: "stopped",
          checkedAt: Date.now(),
        };
      controller.abort();
    };
    const refresh = (): Promise<VerificationResult> => {
      if (stopped)
        return Promise.resolve(
          current ?? { status: "unknown", reason: "stopped" },
        );
      if (inflight) return inflight;
      if (timer) clearTimeout(timer);
      inflight = (async () => {
        const deadline = new AbortController();
        const cycleSignal = AbortSignal.any([signal, deadline.signal]);
        const expires = Date.now() + timeout;
        const watchdog = setTimeout(() => deadline.abort(), timeout);
        let abort!: () => void;
        const interrupted = new Promise<never>((_, reject) => {
          abort = () =>
            reject(new Error(signal.aborted ? "stopped" : "timeout"));
          cycleSignal.addEventListener("abort", abort, { once: true });
          if (cycleSignal.aborted) abort();
        });
        let result: VerificationResult;
        try {
          result = await Promise.race([
            (async () => {
              const advertisement = await query(options.url, {
                ...options,
                signal: cycleSignal,
              });
              return checkCompatibility({ ...options, advertisement });
            })(),
            interrupted,
          ]);
          if (Date.now() >= expires)
            result = { status: "unknown", reason: "timeout" };
        } catch (error) {
          result = {
            status: "unknown",
            reason: cycleSignal.aborted
              ? signal.aborted
                ? "stopped"
                : "timeout"
              : error instanceof DiscoveryError
                ? error.reason
                : "unavailable",
            detail: String(error),
          };
        } finally {
          clearTimeout(watchdog);
          cycleSignal.removeEventListener("abort", abort);
        }
        if (!stopped) publish(result);
        return structuredClone(current ?? result);
      })().finally(() => {
        inflight = undefined;
        if (!stopped)
          timer = setTimeout(() => {
            void refresh();
          }, options.interval);
      });
      return inflight;
    };
    signal.addEventListener("abort", () => stop(), { once: true });
    queueMicrotask(() => {
      if (!stopped) void refresh();
    });
    const latest = (): VerificationResult | undefined => {
      if (
        current?.status === "verified" &&
        Date.now() - current.checkedAt! >= maxAge
      )
        publish({ status: "unknown", reason: "expired" });
      return current && structuredClone(current);
    };
    return {
      stop: () => stop(),
      refresh,
      get current() {
        return latest();
      },
      requireVerified() {
        const result = latest();
        if (stopped || result?.status !== "verified")
          throw new Error(
            `HTTPV dependency is not verified: ${result?.reason ?? "unchecked"}`,
          );
        return result;
      },
    };
  }

  return {
    query,
    verify,
    checkCompatibility,
    watch,
    serve: (input: ServeOptions) => ({ fetch: discoveryHandler(input) }),
  };
}
export const HTTPV = createHTTPV();
