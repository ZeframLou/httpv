/** Run the example against npm-installed HTTPV and ZKLean tarballs, with no
 * Git dependency, native checker, or Lean toolchain available. */
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const sdk = process.argv[2];
if (!sdk) throw new Error("usage: bun scripts/check-package.ts ZKLEAN_TARBALL");
const root = resolve(import.meta.dir, "..");
const temporary = await mkdtemp(join(tmpdir(), "httpv-npm-"));

async function run(command: string[], env: Record<string, string> = {}) {
  const child = Bun.spawn(command, {
    cwd: temporary,
    stdout: "pipe",
    stderr: "inherit",
    env: {
      ...process.env,
      npm_config_cache: join(temporary, "npm-cache"),
      ...env,
    },
  });
  const output = await new Response(child.stdout).text();
  if ((await child.exited) !== 0)
    throw new Error(`${command.join(" ")} failed`);
  return output;
}

try {
  const [packed] = JSON.parse(
    await run(["npm", "pack", "--json", "--pack-destination", temporary, root]),
  );
  await run([
    "npm",
    "install",
    "--offline",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    resolve(sdk),
    join(temporary, packed.filename),
  ]);
  await cp(join(root, "examples"), join(temporary, "examples"), {
    recursive: true,
  });
  const output = await run([process.execPath, "examples/upgrades.ts"], {
    PATH: "/no-native-tools",
    ZKLEAN_NATIVE: "/no-native-checker",
    ELAN_HOME: "/no-lean",
  });
  const expected = [
    'V1: verified (exact-match) -> {"remaining":2}',
    'V2 adds a guarantee: verified (exact-match) -> {"remaining":1}',
    "V3 accepts backorders: incompatible (requirements-not-met) -> request blocked",
  ];
  if (output.trim() !== expected.join("\n"))
    throw new Error(`unexpected example output:\n${output}`);
  console.log(output);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
