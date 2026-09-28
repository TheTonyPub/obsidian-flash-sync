import { stdin, stdout } from "node:process";
import { createTerminalPrompts, terminalPolicy, cancellation } from "../../packages/server-cli/src/prompts.js";

const prompts = createTerminalPrompts(stdin, stdout, terminalPolicy({ inputTTY: !!stdin.isTTY, outputTTY: !!stdout.isTTY }));
try {
  const value = await prompts.select("Choose fixture", Array.from({ length: 12 }, (_, index) => ({
    value: String(index), label: index === 11 ? "日本語 vault" : `Vault ${index}`, description: "fixture metadata",
  })));
  const secret = await prompts.password("Fixture secret");
  const approved = await prompts.confirm("Apply fixture?");
  stdout.write(`RESULT:${value}:${secret === "fixture-only"}:${approved}\n`);
} catch (error) {
  stdout.write(`ERROR:${cancellation(error) ? "INPUT_CANCELLED" : "unexpected"}\n`);
  process.exitCode = cancellation(error) ? 130 : 1;
}
// Keep the fixture alive briefly so the parent can inspect restored termios
// before macOS revokes the controlling terminal when its session leader exits.
await new Promise((resolve) => setTimeout(resolve, 250));
