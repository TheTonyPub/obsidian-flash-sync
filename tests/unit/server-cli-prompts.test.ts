import { describe, expect, it, vi } from "vitest";
import { PassThrough } from "node:stream";
import type { ReadStream, WriteStream } from "node:tty";
import { createTerminalPrompts, terminalPolicy, sanitizeLabel } from "../../packages/server-cli/src/prompts.js";

function terminal() {
  const input = new PassThrough() as unknown as ReadStream;
  const output = new PassThrough() as unknown as WriteStream;
  let text = "";
  output.on("data", (chunk) => { text += chunk; });
  Object.assign(input, { isTTY: true, isRaw: false, setRawMode: vi.fn((raw: boolean) => { input.isRaw = raw; return input; }) });
  Object.assign(output, { isTTY: true, columns: 35, rows: 10, end: () => output });
  return { input, output, text: () => text };
}

describe("CLI terminal policy", () => {
  it("requires both terminals and suppresses unattended and JSON prompts", () => {
    for (const [inputTTY, outputTTY] of [[false, true], [true, false], [false, false]]) {
      expect(terminalPolicy({ inputTTY, outputTTY }, {}).interaction).toBe("none");
    }
    expect(terminalPolicy({ inputTTY: true, outputTTY: true, unattended: true }, {}).interaction).toBe("none");
    expect(terminalPolicy({ inputTTY: true, outputTTY: true, json: true }, {}).interaction).toBe("none");
  });

  it("keeps keyboard selection with NO_COLOR and uses plain dumb-terminal prompts", () => {
    expect(terminalPolicy({ inputTTY: true, outputTTY: true }, { NO_COLOR: "1" })).toEqual({ interaction: "rich", color: false });
    expect(terminalPolicy({ inputTTY: true, outputTTY: true }, { TERM: "dumb" })).toEqual({ interaction: "plain", color: false });
  });

  it("removes terminal controls from display labels without changing printable Unicode", () => {
    expect(sanitizeLabel("research\u001b[31m\n\u009b2J日本語")).toBe("research日本語");
  });

  it("accepts arrow selection without color and restores input after cancellation", async () => {
    const t = terminal(); const p = createTerminalPrompts(t.input, t.output, { interaction: "rich", color: false });
    const selection = p.select("Choose", [{ value: "first", label: "First" }, { value: "second", label: "Second" }]);
    await vi.waitFor(() => expect(t.text()).toContain("First"));
    t.input.emit("data", Buffer.from("\u001b[B\r"));
    expect(await selection).toBe("second"); expect(t.input.isRaw).toBe(false);
    const cancelled = p.select("Again", [{ value: "first", label: "First" }]);
    const rejection = expect(cancelled).rejects.toThrow("INPUT_CANCELLED");
    await vi.waitFor(() => expect(t.text()).toContain("Again"));
    t.input.emit("data", Buffer.from("\u0003"));
    await rejection; expect(t.input.isRaw).toBe(false); expect(t.input.isPaused()).toBe(true);
    expect(t.text()).not.toMatch(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`));
  });

  it("defaults plain confirmation to cancellation without cursor escapes", async () => {
    const t = terminal(); const p = createTerminalPrompts(t.input, t.output, { interaction: "plain", color: false });
    const answer = p.confirm("Apply?");
    await vi.waitFor(() => expect(t.text()).toContain("Choose number"));
    t.input.emit("data", Buffer.from("\n"));
    expect(await answer).toBe(false); expect(t.text()).not.toContain("\u001b");
  });

  it("retries invalid plain input and never echoes a secret", async () => {
    const t = terminal(); const p = createTerminalPrompts(t.input, t.output, { interaction: "plain", color: false });
    const answer = p.input("ID", { validate: (value) => value === "good" || "Invalid ID" });
    await vi.waitFor(() => expect(t.text()).toContain("ID:")); t.input.emit("data", Buffer.from("bad\n"));
    await vi.waitFor(() => expect(t.text()).toContain("Invalid ID")); t.input.emit("data", Buffer.from("good\n"));
    expect(await answer).toBe("good");
    const secret = p.password("Secret");
    await vi.waitFor(() => expect(t.text()).toContain("Secret:")); t.input.emit("data", Buffer.from("fixture-only\r"));
    expect(await secret).toBe("fixture-only"); expect(t.text()).not.toContain("fixture-only"); expect(t.input.isRaw).toBe(false);
  });
});
