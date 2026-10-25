/** Offline scripts run the ZKLean CLI from a checkout: set ZKLEAN_CLI to its
 * src/cli.ts. */
export async function runZKLean(args: string[]): Promise<string> {
  const cli = process.env.ZKLEAN_CLI;
  if (!cli) throw new Error("Set ZKLEAN_CLI to ZKLean's src/cli.ts");
  const child = Bun.spawn([process.execPath, cli, ...args], {
    stdout: "pipe",
    stderr: "inherit",
  });
  const output = await new Response(child.stdout).text();
  if ((await child.exited) !== 0) throw new Error(`ZKLean ${args[0]} failed`);
  return output;
}
