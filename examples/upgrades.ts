/** A supplier upgrades POST /units twice. The client keeps sending requests only
 * while the advertised contract still establishes the requirement its proof uses. */
import { createHTTPV, serve } from "httpv";
import type { Advertisement, Certificate } from "httpv";

const load = (name: string) =>
  Bun.file(
    new URL(`inventory/certificates/${name}.json`, import.meta.url),
  ).json();
const [v1, v2, v3, bridge, requirements] = await Promise.all(
  ["v1", "v2", "v3", "bridge", "requirements"].map(load),
);
const operation = "UnitInventory.POST_units";

// Supplier: publish the current certificate beside the real endpoint.
let contract: Advertisement = { operation, certificate: v1 };
let stock = 3;
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  ...serve({
    routes: { "POST /units": () => contract },
    fetch: () =>
      stock > 0
        ? Response.json({ remaining: --stock }, { status: 201 })
        : new Response("out of stock", { status: 409 }),
  }),
});
const url = `http://127.0.0.1:${server.port}/units`;

// Client: requirements.json is what its proof assumes; the bridge derives it
// from the supplier's V1 guarantee.
const monitor = createHTTPV().watch(
  {
    url,
    method: "POST",
    allowInsecureHttp: true,
    operation,
    requirements,
    bridge,
    allowedAxioms: [],
  },
  { interval: 60_000 },
);

const versions: [string, Certificate][] = [
  ["V1", v1],
  ["V2 adds a guarantee", v2],
  ["V3 accepts backorders", v3],
];
for (const [name, certificate] of versions) {
  contract = { operation, certificate };
  const result = await monitor.refresh();
  let outcome = "request blocked";
  if (result.status === "verified") {
    monitor.requireVerified();
    outcome = await fetch(url, { method: "POST" }).then((r) => r.text());
  }
  console.log(`${name}: ${result.status} (${result.reason}) -> ${outcome}`);
}
monitor.stop();
server.stop(true);
