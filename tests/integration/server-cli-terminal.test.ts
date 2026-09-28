import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { expect, it } from "vitest";

it.skipIf(process.platform === "win32" || spawnSync("python3", ["--version"]).status !== 0)("restores actual PTYs and preserves prompt/output contracts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fos-terminal-"));
  try {
    const fixture = join(directory, "fixture.mjs");
    await build({ entryPoints: ["tests/fixtures/server-cli-terminal.ts"], outfile: fixture,
      bundle: true, platform: "node", format: "esm", target: "node22",
      banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' } });
    const result = spawnSync("python3", ["tests/fixtures/server-cli-terminal.py", process.execPath, fixture, join(process.cwd(), "packages/server-cli/dist/main.js")],
      { encoding: "utf8", timeout: 40000 });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("PTY checks passed");
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 45000);
