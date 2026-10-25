/** The example's Lean modules and the artifacts generated from them. */
export const project = "examples/inventory";
const out = (name: string) => `${project}/certificates/${name}.json`;

/** Each certificate's source: the export that `prove` writes beside it. ZKLean
 * re-verifies every identity, so the URL may follow main. */
export const exportFile = (out: string) => out.replace(/\.json$/, ".ndjson");
export const sourceURL = (out: string) =>
  `https://raw.githubusercontent.com/ZeframLou/httpv/main/${exportFile(out)}`;

export interface Model {
  module: string;
  claims: string[];
  out: string;
}

/** The example proves only from Lean's core, with no axioms. */
export const certificates: Model[] = [
  { module: "V1", claims: ["UnitInventory.conserves"], out: out("v1") },
  {
    module: "V2",
    claims: ["UnitInventory.available_succeeds", "UnitInventory.conserves"],
    out: out("v2"),
  },
  { module: "V3", claims: ["UnitInventory.conserves"], out: out("v3") },
];

export const requirements: Model = {
  module: "Requirements",
  claims: ["UnitInventory.conserves"],
  out: out("requirements"),
};

/** Flags shared by every source command. */
export const source = (model: Model) => [
  "--project",
  project,
  "--module",
  model.module,
  "--claims",
  model.claims.join(","),
];
