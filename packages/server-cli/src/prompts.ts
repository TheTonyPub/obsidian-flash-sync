/* eslint-disable no-control-regex -- Terminal input and labels require explicit control-character filtering. */
import { input as textPrompt, password as passwordPrompt, select as selectPrompt } from "@inquirer/prompts";
import { createInterface } from "node:readline/promises";
import type { ReadStream, WriteStream } from "node:tty";

export interface Choice<T extends string> { value: T; label: string; description?: string }
export interface InputOptions { default?: string; validate?: (value: string) => true | string }
export interface CliPrompts {
  select<T extends string>(message: string, choices: readonly Choice<T>[], defaultValue?: T): Promise<T>;
  input(message: string, options?: InputOptions): Promise<string>;
  password(message: string, options?: InputOptions): Promise<string>;
  confirm(message: string): Promise<boolean>;
}

export function terminalPolicy(
  options: { inputTTY: boolean; outputTTY: boolean; unattended?: boolean; json?: boolean },
  env: NodeJS.ProcessEnv = process.env,
): { interaction: "none" | "plain" | "rich"; color: boolean } {
  if (!options.inputTTY || !options.outputTTY || options.unattended || options.json) return { interaction: "none", color: false };
  return { interaction: env.TERM === "dumb" ? "plain" : "rich", color: env.TERM !== "dumb" && env.NO_COLOR === undefined };
}

export function sanitizeLabel(value: string): string {
  // Strip CSI/OSC sequences before dropping remaining control characters.
  return value.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/[\x1b\x9b]\[[0-?]*[ -/]*[@-~]|\x9b[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\x00-\x1f\x7f-\x9f]/g, "");
}

export function cancellation(error: unknown): boolean {
  return error instanceof Error && ["INPUT_CANCELLED", "ExitPromptError", "AbortPromptError"].includes(error.message === "INPUT_CANCELLED" ? error.message : error.name);
}

export function createTerminalPrompts(
  input: ReadStream,
  output: WriteStream,
  policy: ReturnType<typeof terminalPolicy>,
): CliPrompts {
  const identity = (value: string): string => value;
  const theme = policy.color ? undefined : {
    prefix: { idle: "?", done: "✓" },
    style: { answer: identity, message: identity, error: identity, help: identity,
      highlight: identity, description: identity, disabled: identity, key: identity, defaultAnswer: identity },
  };
  const context = { input, output };
  const run = async <T>(operation: () => Promise<T>): Promise<T> => {
    if (policy.interaction === "none") throw new Error("INTERACTIVE_INPUT_REQUIRED");
    const raw = input.isRaw;
    try { return await operation(); }
    catch (error) { if (cancellation(error)) throw new Error("INPUT_CANCELLED"); throw error; }
    finally {
      if (input.isTTY && input.isRaw !== raw) input.setRawMode(Boolean(raw));
      input.pause();
    }
  };
  const askPlain = async (message: string): Promise<string> => {
    const reader = createInterface({ input, output, terminal: false });
    let cancel: () => void = () => {};
    try {
      return await new Promise<string>((resolve, reject) => {
        cancel = () => reject(new Error("INPUT_CANCELLED"));
        process.once("SIGINT", cancel);
        reader.once("close", cancel);
        reader.question(message).then(resolve, reject);
      });
    } finally {
      process.off("SIGINT", cancel); reader.off("close", cancel); reader.close();
    }
  };
  const secretPlain = (message: string): Promise<string> => new Promise((resolve, reject) => {
    const wasRaw = input.isRaw;
    let value = "";
    let finished = false;
    const finish = (cancelled = false): void => {
      if (finished) return;
      finished = true;
      input.off("data", receive); input.off("end", cancel); process.off("SIGINT", cancel);
      input.setRawMode(Boolean(wasRaw)); output.write("\n");
      if (cancelled) reject(new Error("INPUT_CANCELLED")); else resolve(value);
    };
    const cancel = (): void => finish(true);
    const receive = (chunk: Buffer | string): void => {
      const text = chunk.toString().replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
      for (const character of text) {
        if (character === "\u0003" || character === "\u0004") { finish(true); return; }
        if (character === "\r" || character === "\n") { finish(); return; }
        if (character === "\u007f" || character === "\b") value = [...value].slice(0, -1).join("");
        else if (character >= " " && character !== "\u001b") value += character;
      }
    };
    // Disable kernel echo and install listeners before announcing readiness.
    input.setRawMode(true); input.on("data", receive); input.once("end", cancel); process.once("SIGINT", cancel);
    input.resume(); output.write(`${message}: `);
  });
  const collect = (secret: boolean, message: string, options: InputOptions = {}): Promise<string> => run(async () => {
    const label = sanitizeLabel(message);
    if (policy.interaction === "rich") {
      return secret
        ? passwordPrompt({ message: label, mask: false, validate: options.validate, theme }, context)
        : textPrompt({ message: label, default: options.default, validate: options.validate, theme }, context);
    }
    while (true) {
      const value = secret ? await secretPlain(label) : (await askPlain(`${label}${options.default !== undefined ? ` [${options.default}]` : ""}: `)).trim() || options.default || "";
      const valid = options.validate?.(value) ?? true;
      if (valid === true) return value;
      output.write(`${sanitizeLabel(valid)}\n`);
    }
  });
  const select: CliPrompts["select"] = (message, choices, defaultValue) => run(async () => {
    if (!choices.length) throw new Error("CHOICES_REQUIRED");
    const sanitized = choices.map((choice) => ({ value: choice.value, name: sanitizeLabel(choice.label), description: choice.description && sanitizeLabel(choice.description) }));
    if (policy.interaction === "rich") return selectPrompt({ message: sanitizeLabel(message), choices: sanitized, default: defaultValue,
      pageSize: Math.max(1, Math.min(7, (output.rows || 24) - 6)), theme }, context);
    output.write(`${sanitizeLabel(message)}\n${sanitized.map((choice, index) => `  ${index + 1}) ${choice.name}${choice.description ? ` — ${choice.description}` : ""}`).join("\n")}\n`);
    while (true) {
      const answer = (await askPlain("Choose number (Enter uses default): ")).trim();
      if (!answer && defaultValue !== undefined) return defaultValue;
      const selected = sanitized[Number(answer) - 1];
      if (selected) return selected.value;
      output.write("Enter a listed number.\n");
    }
  });
  return { select, input: (message, options) => collect(false, message, options), password: (message, options) => collect(true, message, options),
    confirm: async (message) => (await select(message, [{ label: "Cancel", value: "no" }, { label: "Apply", value: "yes" }], "no")) === "yes" };
}
