/** Regenerate committed Lean export fixtures from the pinned source exporter. */
import { resolve } from "node:path";
import { runZKLean } from "./zklean.ts";
import { inventoryAxioms } from "../examples/inventory.ts";

export const examples = [
  {
    module: "V1",
    file: "v1",
    claims: ["Inventory.reservation_safe"],
    axioms: inventoryAxioms,
  },
  {
    module: "V2",
    file: "v2",
    claims: ["Inventory.reservation_safe", "Inventory.valid_request_succeeds"],
    axioms: inventoryAxioms,
  },
  {
    module: "V3",
    file: "v3",
    claims: ["Inventory.reservation_safe"],
    axioms: [],
  },
  {
    module: "Requirements",
    file: "requirements",
    claims: ["Client.stock_conserved"],
    axioms: [],
  },
  {
    module: "Bridge",
    file: "bridge",
    claims: ["Client.stock_conserved"],
    axioms: ["Inventory.reservation_safe"],
  },
  {
    module: "Axioms",
    file: "axioms",
    claims: ["Inventory.assumed_safe"],
    axioms: ["Trusted.evidence", "Trusted.stock_policy"],
  },
  {
    module: "ChangedDefinition",
    file: "changed-definition",
    claims: ["Inventory.reservation_safe"],
    axioms: [],
  },
];
