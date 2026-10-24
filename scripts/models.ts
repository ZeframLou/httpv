/** Every Lean model the repository checks, and where its artifacts live. */
export interface Model {
  project: string;
  module: string;
  claims: string[];
  axioms: string[];
  policy: string;
  /** Checked public model, or the requirements snapshot when `requirements`. */
  out: string;
  requirements?: true;
  /** Real Groth16 certificate proving this model. */
  certificate?: string;
}

/** Edge cases for the policy tests, which sign their checked models. */
const fixture = (
  module: string,
  name: string,
  claims: string[],
  axioms: string[] = [],
): Model => ({
  project: "tests/fixtures/lean",
  policy: "tests/fixtures/lean/axioms.json",
  module,
  claims,
  axioms,
  out: `tests/fixtures/${name}.statement.json`,
});

/** The runnable example, with real certificates. */
const example = (
  module: string,
  name: string,
  claims: string[],
  axioms: string[] = [],
): Model => ({
  project: "examples/inventory",
  policy: "examples/inventory/axioms.json",
  module,
  claims,
  axioms,
  out: `tests/fixtures/unit/${name}.statement.json`,
  certificate: `examples/inventory/certificates/${name}.json`,
});

export const models: Model[] = [
  fixture("V1", "v1", ["Inventory.reservation_safe"], ["propext"]),
  fixture(
    "V2",
    "v2",
    ["Inventory.reservation_safe", "Inventory.valid_request_succeeds"],
    ["propext"],
  ),
  fixture("V3", "v3", ["Inventory.reservation_safe"]),
  fixture(
    "Bridge",
    "bridge",
    ["Client.stock_conserved"],
    ["Inventory.reservation_safe"],
  ),
  fixture(
    "Independent",
    "independent",
    ["Client.stock_conserved"],
    ["propext"],
  ),
  fixture("ChangedDefinition", "changed-definition", [
    "Inventory.reservation_safe",
  ]),
  fixture("RenamedOperation", "renamed-operation", [
    "Backorders.reservation_safe",
  ]),
  fixture(
    "WeakenedClaim",
    "weakened-claim",
    ["Inventory.reservation_safe"],
    ["propext"],
  ),
  {
    ...fixture("Requirements", "requirements", ["Client.stock_conserved"]),
    out: "tests/fixtures/requirements.json",
    requirements: true,
  },
  example("V1", "v1", ["UnitInventory.conserves"]),
  example("V2", "v2", [
    "UnitInventory.available_succeeds",
    "UnitInventory.conserves",
  ]),
  example("V3", "v3", ["UnitInventory.conserves"]),
  example(
    "Bridge",
    "bridge",
    ["UnitClient.nonempty"],
    ["UnitInventory.conserves"],
  ),
  {
    ...fixture("Requirements", "requirements", ["UnitClient.nonempty"]),
    project: "examples/inventory",
    policy: "examples/inventory/axioms.json",
    out: "examples/inventory/certificates/requirements.json",
    requirements: true,
  },
];
