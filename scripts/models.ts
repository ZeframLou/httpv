/** Source declarations for offline generation and formal artifact validation. */
import { inventoryAxioms } from "../examples/inventory.ts";

const inventory = [
  {
    module: "Independent",
    file: "independent",
    claims: ["Client.stock_conserved"],
    axioms: inventoryAxioms,
  },
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
  {
    module: "RenamedOperation",
    file: "renamed-operation",
    claims: ["Backorders.reservation_safe"],
    axioms: [],
  },
];

export interface ModelExample {
  project: string;
  modelPath: string;
  certificatePath?: string;
  module: string;
  file: string;
  claims: string[];
  axioms: string[];
  policy: string;
  requirements: boolean;
  certificate: boolean;
}
export const inventoryExamples: ModelExample[] = inventory.map((entry) => ({
  ...entry,
  project: "examples/lean",
  policy: "examples/axioms.json",
  modelPath: `tests/fixtures/${entry.file}${entry.file === "requirements" ? "" : ".statement"}.json`,
  requirements: entry.file === "requirements",
  certificate: ["v1", "v2", "v3", "bridge"].includes(entry.file),
}));
export const unitExamples: ModelExample[] = [
  { module: "V1", file: "v1", claims: ["UnitInventory.conserves"], axioms: [] },
  {
    module: "V2",
    file: "v2",
    claims: ["UnitInventory.available_succeeds", "UnitInventory.conserves"],
    axioms: [],
  },
  { module: "V3", file: "v3", claims: ["UnitInventory.conserves"], axioms: [] },
  {
    module: "Bridge",
    file: "bridge",
    claims: ["UnitClient.nonempty"],
    axioms: ["UnitInventory.conserves"],
  },
  {
    module: "Requirements",
    file: "requirements",
    claims: ["UnitClient.nonempty"],
    axioms: [],
  },
].map((entry) => ({
  ...entry,
  file: `unit/${entry.file}`,
  project: "examples/unit-inventory",
  policy: "examples/unit-inventory/axioms.json",
  modelPath:
    entry.file === "requirements"
      ? "examples/unit-inventory/certificates/requirements.json"
      : `tests/fixtures/unit/${entry.file}.statement.json`,
  ...(entry.file === "requirements"
    ? {}
    : {
        certificatePath: `examples/unit-inventory/certificates/${entry.file}.json`,
      }),
  requirements: entry.file === "requirements",
  certificate: entry.file !== "requirements",
}));
export const examples = [...inventoryExamples, ...unitExamples];
