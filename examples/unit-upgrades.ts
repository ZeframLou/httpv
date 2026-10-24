import { fileURLToPath } from "node:url";
import { unitInventoryFlow } from "./unit-flow.ts";

const results = await unitInventoryFlow(
  fileURLToPath(new URL("./unit-inventory/certificates/", import.meta.url)),
);
console.log(JSON.stringify(results, null, 2));
if (
  results.states.map((state) => state.status).join(",") !==
    "verified,verified,incompatible" ||
  results.derived.status !== "verified" ||
  results.rebound.status !== "incompatible" ||
  results.rejected.status !== "unknown" ||
  results.requests !== 2
)
  throw new Error("inventory upgrade workflow failed");
