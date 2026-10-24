/** Offline scripts use the installed CLI through its public command interface. */
export async function runZKLean(args: string[]): Promise<string> {
  const cli = process.env.ZKLEAN_CLI ?? Bun.which("zklean");
  if (!cli)
    throw new Error("Install ZKLean or set ZKLEAN_CLI to its executable");
  const child = Bun.spawn([cli, ...args], {
    stdout: "pipe",
    stderr: "inherit",
  });
  const output = await new Response(child.stdout).text();
  if ((await child.exited) !== 0) throw new Error(`ZKLean ${args[0]} failed`);
  return output;
}
