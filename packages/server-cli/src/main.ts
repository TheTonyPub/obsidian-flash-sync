import { stdin, stdout } from "node:process";
import { runBackupCommand, runBootstrap, runImportCommand, runLifecycleCommand, runVaultCommand, validatePhrase, type HostAdapter, type RunVaultCommandOptions } from "./cli.js";
import { createLocalBackupAdapter } from "./backup.js";
import { createLocalCredentialStore, createLocalOwnedStateAdapter, localPathExists, readLocalPlatform, readLocalProtectedInput } from "./host.js";
import { buildImportHandoff } from "./handoff-builder.js";
import { readOwnedStatus } from "./state.js";
import { createBootstrapApply, createLocalLifecycleAdapters, createLocalRuntime, createSecretOutputAdapter, createVaultAdminAdapter, createVaultUserAdapter, createVaultVerificationAdapter } from "./host-deployment.js";
import { formatCliHelp, formatFailure, formatHandoffOutput, formatHumanOutput, formatPreview, formatVaultResult, helpTopicForArgs, renderHandoffQr, withSpinner } from "./ui.js";

import { cancellation, createTerminalPrompts, terminalPolicy } from "./prompts.js";
import { runVaultBrowser, vaultEntry } from "./vault-browser.js";

const cliArgs = process.argv.slice(2);
const policy = terminalPolicy({ inputTTY: Boolean(stdin.isTTY), outputTTY: Boolean(stdout.isTTY),
  unattended: cliArgs.includes("--non-interactive"), json: cliArgs.includes("--json") });
const interactive = policy.interaction !== "none";
const prompts = createTerminalPrompts(stdin, stdout, policy);
const useColor = policy.color;
const paint = (value: string, code: string): string => useColor ? `\u001b[${code}m${value}\u001b[0m` : value;
const reportError = (error: unknown): void => {
  const cancelled = cancellation(error);
  const message = cancelled ? "INPUT_CANCELLED" : error instanceof Error ? error.message : String(error);
  stdout.write(`${formatFailure(message, useColor, interactive)}\n`);
  process.exitCode = cancelled ? 130 : 1;
};
const host: HostAdapter = { platform: readLocalPlatform, readProtectedInput: readLocalProtectedInput, pathExists: localPathExists };
const promptSecret = interactive ? (question: string) => prompts.password(question) : undefined;
const promptEndpoint = interactive ? () => prompts.input("WSS endpoint", { validate: (value) => {
  try { const url = new URL(value); return url.protocol === "wss:" && !!url.hostname || "Enter a valid wss:// endpoint."; }
  catch { return "Enter a valid wss:// endpoint."; }
} }) : undefined;
const promptEncryptionPhrase = interactive ? () => prompts.password("Optional QR encryption phrase (Enter for plaintext)", { validate: validatePhrase }) : undefined;

const runtime = createLocalRuntime();
const lifecycle = createLocalLifecycleAdapters(runtime, createLocalOwnedStateAdapter());
const credentialStore = createLocalCredentialStore();
const protectedHandoffOutput = process.argv.slice(2).some((arg) => arg === "--secrets-output" || arg.startsWith("--secrets-output="));
const renderHandoff = (config: Parameters<typeof buildImportHandoff>[0]) => buildImportHandoff(config, {
  renderQr: (uri) => renderHandoffQr(uri, Boolean(stdout.isTTY && useColor), protectedHandoffOutput),
});
const discloseHandoff = interactive
  ? (contents: string): void => { stdout.write(`${formatHandoffOutput(contents, useColor)}\n`); }
  : undefined;

const helpTopic = cliArgs.length === 1 && cliArgs[0] === "vault" && interactive ? undefined : helpTopicForArgs(cliArgs);
if (helpTopic) {
  stdout.write(`${formatCliHelp(helpTopic, Boolean(stdout.isTTY && useColor))}\n`);
} else if (process.argv[2] === "backup" || process.argv[2] === "restore-check") {
  runBackupCommand(process.argv.slice(2), { isRoot: () => process.getuid?.() === 0, adapter: createLocalBackupAdapter() }).then((result) => {
    const text = `fos: backup artifact: ${result.artifact}${result.restored ? "\nrestore verified" : ""}`;
    stdout.write(`${stdout.isTTY ? formatHumanOutput(text, useColor) : text}\n`);
  }).catch((error: unknown) => { stdout.write(`${formatFailure(error instanceof Error ? error.message : String(error), useColor, Boolean(stdout.isTTY))}\n`); process.exitCode = 1; });
} else if (process.argv[2] === "upgrade" || process.argv[2] === "uninstall") {
  runLifecycleCommand(process.argv.slice(2), { ...lifecycle, isRoot: () => process.getuid?.() === 0 }).then((result) => {
    stdout.write(`${stdout.isTTY ? formatHumanOutput(result, useColor) : result}\n`);
  }).catch(reportError);
} else if (process.argv[2] === "vault") {
  const suppliedArgs = cliArgs.slice(1);
  const vaultArgs = suppliedArgs.filter((arg) => arg !== "--json");
  const options: RunVaultCommandOptions = {
    host, prompts: interactive ? prompts : undefined,
    showReview: interactive ? (review) => { stdout.write(`${formatPreview(review, useColor)}\n`); } : undefined,
    resolveMode: async () => {
      const status = await readOwnedStatus(await createLocalOwnedStateAdapter());
      return status.kind === "MANAGED" ? status.mode : undefined;
    },
    createAdapter: (plan) => createVaultUserAdapter(runtime, plan),
    createAdminAdapter: (plan, administrator) => createVaultAdminAdapter(runtime, plan, administrator),
    createVerificationAdapter: (plan, credentials, crossVaultId) => createVaultVerificationAdapter(runtime, plan, credentials, crossVaultId),
    secretOutput: createSecretOutputAdapter(runtime), discloseInteractiveSecrets: discloseHandoff,
    promptSecret, promptEndpoint, promptEncryptionPhrase, credentialStore, renderHandoff,
    unattended: !interactive, json: suppliedArgs.includes("--json") || !stdout.isTTY,
  };
  Promise.resolve().then(async () => {
    const entry = vaultEntry(suppliedArgs, interactive);
    if (entry === "help") { stdout.write(`${formatCliHelp("vault", useColor)}\n`); return; }
    if (entry === "browser") {
      await runVaultBrowser(vaultArgs, { vault: options, prompts, color: useColor, report: (text) => { stdout.write(`${text}\n`); } });
      return;
    }
    const result = await runVaultCommand(vaultArgs, options);
    if (options.json && result !== undefined) stdout.write(`${JSON.stringify(result)}\n`);
    else if (result !== undefined) stdout.write(`${formatVaultResult(result, useColor)}\n`);
    else if (vaultArgs[0] === "revoke" && stdout.isTTY) stdout.write(`${paint("Vault user revoked.", "32")}\n`);
  }).catch(reportError);
} else if (process.argv[2] === "import") {
  runImportCommand(process.argv.slice(2), {
    credentialStore,
    renderHandoff,
    promptEndpoint,
    promptEncryptionPhrase,
    discloseInteractiveSecrets: discloseHandoff,
    secretOutput: createSecretOutputAdapter(runtime),
    unattended: !interactive,
  }).catch(reportError);
} else {

if (interactive && stdout.isTTY && process.argv[2] === "bootstrap") stdout.write(`${paint("◆ fos", "1;36")} ${paint("server bootstrap", "2")}\n\n`);
const applyBootstrap = createBootstrapApply(runtime);
let previewShown = false;

runBootstrap(process.argv.slice(2), {
  host,
  state: createLocalOwnedStateAdapter(),
  apply: async (plan, credentials) => {
    if (policy.interaction !== "rich") return applyBootstrap(plan, credentials);
    return withSpinner("Applying bootstrap plan", () => applyBootstrap(plan, credentials), stdout);
  },
  secretOutput: createSecretOutputAdapter(runtime),
  discloseInteractiveSecrets: discloseHandoff,
  credentialStore,
  renderHandoff,
  promptEncryptionPhrase,
  prompts: interactive ? prompts : undefined,
  showPreview: (preview) => {
    if (process.argv[2] === "status" || process.argv[2] === "plan") return;
    previewShown = true;
    stdout.write(`${interactive && stdout.isTTY ? formatPreview(preview, useColor) : preview}\n`);
  },
}).then((result) => {
  if (process.argv[2] === "status" || process.argv[2] === "plan" || !previewShown && !stdin.isTTY) {
    stdout.write(`${interactive && stdout.isTTY ? formatPreview(result.preview, useColor) : result.preview}\n`);
  }
  if (process.argv[2] !== "status" && !result.applied) stdout.write(`${interactive && stdout.isTTY ? paint("Plan not applied.", "2") : "Plan not applied."}\n`);
  else if (interactive && stdout.isTTY && result.applied) stdout.write(`${paint("Bootstrap complete.", "32")}\n`);
}).catch(reportError);
}
