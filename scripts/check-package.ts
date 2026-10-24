/** Install actual npm tarballs; no Git dependency or native verifier is used. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

const sdk = process.argv[2];
if (!sdk)
  throw new Error("usage: bun scripts/check-package.ts PATH_TO_ZKLEAN_TARBALL");
const root = resolve(import.meta.dir, "..");
const temporary = await mkdtemp(join(tmpdir(), "httpv-npm-"));
async function run(command: string[], cwd = temporary, isolated = false) {
  const child = Bun.spawn(command, {
    cwd,
    stdout: "pipe",
    stderr: "inherit",
    env: {
      ...process.env,
      npm_config_cache: join(temporary, "npm-cache"),
      ...(isolated
        ? {
            PATH: "/no-native-tools",
            ZKLEAN_NATIVE: "/no-native-verifier",
            ELAN_HOME: "/no-lean",
          }
        : {}),
    },
  });
  const text = await new Response(child.stdout).text();
  if ((await child.exited) !== 0) throw new Error(`${command[0]} failed`);
  return text;
}
try {
  const packed = JSON.parse(
    await run(["npm", "pack", "--json", "--pack-destination", temporary], root),
  );
  await run([
    "npm",
    "install",
    "--offline",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    resolve(sdk),
    join(temporary, packed[0].filename),
  ]);
  // Typecheck and run the actual packaged entry point and its packaged data.
  await Bun.write(
    join(temporary, "consumer.ts"),
    'import "./node_modules/httpv/examples/unit-upgrades.ts";\n',
  );
  await run([
    process.execPath,
    join(root, "node_modules/typescript/bin/tsc"),
    "--noEmit",
    "--strict",
    "--skipLibCheck",
    "--module",
    "esnext",
    "--moduleResolution",
    "bundler",
    "--target",
    "esnext",
    "--allowImportingTsExtensions",
    "--resolveJsonModule",
    "--types",
    "bun",
    "--typeRoots",
    join(root, "node_modules/@types"),
    "consumer.ts",
  ]);
  console.log("npm-installed HTTPV consumer typechecked.");
  const result = JSON.parse(
    await run([process.execPath, "consumer.ts"], temporary, true),
  );
  if (
    result.states.map((state: { status: string }) => state.status).join(",") !==
      "verified,verified,incompatible" ||
    result.derived.status !== "verified" ||
    result.rebound.status !== "incompatible" ||
    result.rejected.status !== "unknown" ||
    result.requests !== 2
  )
    throw new Error("installed inventory workflow failed");
  console.log(
    "npm-installed HTTPV ran its packaged real inventory workflow without native tools.",
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
