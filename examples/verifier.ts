import type { NativeOptions } from "zklean";

/** Read the trusted local installation, never a profile supplied by an endpoint. */
export async function installedVerifier(): Promise<NativeOptions> {
  const cli = process.env.ZKLEAN_CLI ?? Bun.which("zklean");
  if (!cli)
    throw new Error("Install ZKLean or set ZKLEAN_CLI to its executable");
  const child = Bun.spawn([cli, "doctor"], {
    stdout: "pipe",
    stderr: "inherit",
  });
  const tools = await new Response(child.stdout).json();
  if (
    (await child.exited) !== 0 ||
    !tools.config.available ||
    !tools.binary.available
  )
    throw new Error("ZKLean installation is incomplete; run zklean doctor");
  const profile = await Bun.file(tools.config.path).json();
  return {
    binary: tools.binary.path,
    verifierKey: profile.verifierKey,
    verificationKey: profile.verificationKey,
  };
}
