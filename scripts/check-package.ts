/** Install actual npm tarballs; no Git dependency or native verifier is used. */
import { mkdtemp, rm, copyFile } from "node:fs/promises";
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
        ? { PATH: "/no-native-tools", ZKLEAN_NATIVE: "/no-native-verifier" }
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
  await copyFile(
    join(root, "tests/fixtures/identity.certificate.json"),
    join(temporary, "certificate.json"),
  );
  await Bun.write(
    join(temporary, "consumer.ts"),
    `
import { createHTTPV } from "httpv";
const httpv = createHTTPV();
const certificate = await Bun.file("certificate.json").json();
const server = Bun.serve({hostname: "127.0.0.1", port: 0, ...httpv.serve({
  routes: {"POST /identity": certificate}, fetch: () => new Response("ok"),
})});
try {
  const received = await httpv.query(
    "http://127.0.0.1:" + server.port + "/identity", {method: "POST", allowInsecureHttp: true},
  );
  const result = await httpv.checkCompatibility({certificate: received,
    requirements: {format: "zklean/requirements/1", specs: certificate.specs},
    mode: "exact", allowedAxioms: [],
  });
  if (result.status !== "verified") throw new Error(JSON.stringify(result));
  console.log("npm-installed HTTPV discovered and verified a real proof without native tools.");
} finally { server.stop(true); }
`,
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
  console.log(
    (await run([process.execPath, "consumer.ts"], temporary, true)).trim(),
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
