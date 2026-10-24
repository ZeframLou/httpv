/** The example's Lean modules and the artifacts generated from them. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runZKLean } from "./zklean.ts";

export const project = "examples/inventory";
const out = (name: string) => `${project}/certificates/${name}.json`;
const operation = "UnitInventory.POST_units";

/** The bridge assumes V1's claim; this file pins it to V1's identity. */
export const bridgePolicy = `${project}/axioms.json`;

/** Each certificate's source: the export that `prove` writes beside it. ZKLean
 * re-verifies every identity, so the URL may follow main. */
export const exportFile = (out: string) => out.replace(/\.json$/, ".ndjson");
export const sourceURL = (out: string) =>
  `https://raw.githubusercontent.com/ZeframLou/httpv/main/${exportFile(out)}`;

export interface Model {
  module: string;
  claims: string[];
  definitions: string[];
  axioms: string[];
  out: string;
}

export const certificates: Model[] = [
  {
    module: "V1",
    claims: ["UnitInventory.conserves"],
    definitions: [operation],
    axioms: [],
    out: out("v1"),
  },
  {
    module: "V2",
    claims: ["UnitInventory.available_succeeds", "UnitInventory.conserves"],
    definitions: [operation],
    axioms: [],
    out: out("v2"),
  },
  {
    module: "V3",
    claims: ["UnitInventory.conserves"],
    definitions: [operation],
    axioms: [],
    out: out("v3"),
  },
  {
    module: "Bridge",
    claims: ["UnitClient.nonempty"],
    definitions: [],
    axioms: ["UnitInventory.conserves"],
    out: out("bridge"),
  },
];

export const requirements: Omit<Model, "axioms"> = {
  module: "Requirements",
  claims: ["UnitClient.nonempty"],
  definitions: [operation],
  out: out("requirements"),
};

/** Flags shared by every source command. */
export function source(model: Omit<Model, "axioms" | "out">): string[] {
  return [
    "--project",
    project,
    "--module",
    model.module,
    "--claims",
    model.claims.join(","),
    ...(model.definitions.length
      ? ["--definitions", model.definitions.join(",")]
      : []),
  ];
}

export function axiomFlags(model: Model): string[] {
  return model.axioms.length
    ? ["--axioms", model.axioms.join(","), "--axiom-policy", bridgePolicy]
    : [];
}

/** Run a requirements command and return its JSON output. */
export async function generateRequirements(
  model: Omit<Model, "axioms" | "out">,
): Promise<{ claims: Record<string, string> }> {
  const directory = await mkdtemp(join(tmpdir(), "httpv-requirements-"));
  try {
    const path = join(directory, "requirements.json");
    await runZKLean(["requirements", ...source(model), "--out", path]);
    return await Bun.file(path).json();
  } finally {
    await rm(directory, { recursive: true });
  }
}

/** The identity of V1's claim, as the bridge's axiom policy. */
export async function expectedBridgePolicy(): Promise<Record<string, string>> {
  return (await generateRequirements(certificates[0]!)).claims;
}
