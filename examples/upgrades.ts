/** A supplier upgrades POST /units twice. The client keeps sending requests only
 * while the advertised certificate still establishes the requirement its proof uses. */
import { createHTTPV, serve } from "httpv";
import type { Certificate } from "httpv";

const load = (name: string) =>
  Bun.file(
    new URL(`inventory/certificates/${name}.json`, import.meta.url),
  ).json();
const [v1, v2, v3, requirements] = await Promise.all(
  ["v1", "v2", "v3", "requirements"].map(load),
);

// Supplier: publish the current certificate beside the real endpoint.
let published: Certificate = v1;
let stock = 3;
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  ...serve({
    routes: { "POST /units": () => published },
    fetch: () =>
      stock > 0
        ? Response.json({ remaining: --stock }, { status: 201 })
        : new Response("out of stock", { status: 409 }),
  }),
});
const url = `http://127.0.0.1:${server.port}/units`;

// Client: requirements.json is the supplier claim its own proof assumes.
const httpv = createHTTPV();
const inventory = {
  url,
  method: "POST",
  allowInsecureHttp: true,
  requirements,
  axioms: {},
};

const versions: [string, Certificate][] = [
  ["V1", v1],
  ["V2 adds a guarantee", v2],
  ["V3 accepts backorders", v3],
];
for (const [name, certificate] of versions) {
  published = certificate;
  const result = await httpv.check(inventory);
  const outcome =
    result.status === "verified"
      ? await fetch(url, { method: "POST" }).then((r) => r.text())
      : "request blocked";
  console.log(`${name}: ${result.status} (${result.reason}) -> ${outcome}`);
}
server.stop(true);
