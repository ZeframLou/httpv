/** A complete inventory upgrade workflow using only installed public APIs. */
import { createHTTPV } from "httpv";
import { parseCertificate } from "zklean";
import type { VerificationResult } from "httpv";
import { join } from "node:path";

export async function unitInventoryFlow(fixtures: string) {
  const [v1, v2, v3, bridge] = await Promise.all(
    ["v1", "v2", "v3", "bridge"].map(async (name) =>
      parseCertificate(await Bun.file(join(fixtures, `${name}.json`)).json()),
    ),
  );
  const requirements = await Bun.file(
    join(fixtures, "requirements.json"),
  ).json();
  const httpv = createHTTPV();
  let current = v1!;
  let operation = "UnitInventory.POST_units";
  let backorders = false;
  let available = 2;
  let requests = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    ...httpv.serve({
      routes: {
        "POST /units": () => ({
          operation,
          certificate: current,
        }),
      },
      fetch: (request) => {
        if (
          request.method !== "POST" ||
          new URL(request.url).pathname !== "/units"
        )
          return new Response("Not found", { status: 404 });
        requests++;
        if (operation === "UnitInventory.Stock.more") {
          available++;
          return Response.json({ remaining: available });
        }
        if (!available && !backorders)
          return new Response("No units", { status: 409 });
        available = Math.max(0, available - 1);
        return Response.json(
          { reserved: 1, remaining: available },
          { status: 201 },
        );
      },
    }),
  });
  const url = `http://127.0.0.1:${server.port}/units`;
  const monitor = httpv.watch({
    url,
    method: "POST",
    allowInsecureHttp: true,
    requirements: { format: "zklean/requirements/1", specs: v1!.specs },
    operation: "UnitInventory.POST_units",
    allowedAxioms: [],
    mode: "exact",
    interval: 60_000,
  });
  const states: VerificationResult[] = [];
  const blocked: string[] = [];
  const receipts: unknown[] = [];
  try {
    for (const [index, certificate] of [v1!, v2!, v3!].entries()) {
      current = certificate;
      backorders = index === 2;
      const result = await monitor.refresh();
      states.push(result);
      try {
        monitor.requireVerified();
      } catch {
        blocked.push(result.reason);
        continue;
      }
      const response = await fetch(url, { method: "POST" });
      if (response.status !== 201)
        throw new Error(`unit reservation failed: ${response.status}`);
      receipts.push(await response.json());
    }
    current = v2!;
    backorders = false;
    const advertisement = await httpv.query(url, {
      method: "POST",
      allowInsecureHttp: true,
    });
    const derived = await httpv.checkCompatibility({
      advertisement,
      requirements,
      derivation: bridge,
      operation: "UnitInventory.POST_units",
      allowedAxioms: [],
    });
    // The same valid certificate also contains helper declarations. A change
    // of endpoint entrypoint must invalidate acceptance even with a cache hit.
    operation = "UnitInventory.Stock.more";
    const rebound = await monitor.refresh();
    let reboundBlocked = false;
    try {
      monitor.requireVerified();
    } catch {
      blocked.push(rebound.reason);
      reboundBlocked = true;
    }
    if (!reboundBlocked) await fetch(url, { method: "POST" });
    operation = "UnitInventory.POST_units";
    const tampered = structuredClone(v2!);
    const proof = Buffer.from(tampered.proof.slice(7), "base64");
    proof[40] = proof[40]! ^ 1;
    tampered.proof = `base64:${proof.toString("base64")}`;
    current = tampered;
    const rejected = await monitor.refresh();
    try {
      monitor.requireVerified();
    } catch {
      blocked.push(rejected.reason);
    }
    return {
      states,
      derived,
      rebound,
      rejected,
      blocked,
      receipts,
      requests,
      available,
    };
  } finally {
    monitor.stop();
    server.stop(true);
  }
}
