import { runImportCommand, runVaultCommand, type RunVaultCommandOptions } from "./cli.js";
import { formatVaultResult } from "./ui.js";
import type { CliPrompts } from "./prompts.js";
import type { VaultBucket } from "./vault-admin.js";

const browserValues = ["--mode", "--admin-input", "--secrets-output", "--wss-endpoint"];
const listValues = ["--mode", "--admin-input"];
function validateOptions(args: string[], list: boolean): void {
  for (let i = 0; i < args.length; i++) {
    const option = args[i];
    if (!list && option === "--keep") continue;
    if (!(list ? listValues : browserValues).includes(option)) throw new Error(`UNKNOWN_BROWSER_OPTION:${option}`);
    if (!args[++i] || args[i].startsWith("--")) throw new Error(`OPTION_VALUE_REQUIRED:${option}`);
  }
}

export function vaultEntry(args: string[], interactive: boolean): "help" | "browser" | "command" {
  const list = args[0] === "list";
  const explicit = args.includes("--interactive");
  if (explicit && !list) throw new Error("UNKNOWN_VAULT_OPTION:--interactive");
  if (explicit && args.includes("--json")) throw new Error("INCOMPATIBLE_OUTPUT_OPTIONS");
  if (explicit && !interactive) throw new Error("INTERACTIVE_TERMINAL_REQUIRED");
  if (explicit || !args.length || args[0].startsWith("--")) {
    validateOptions((list ? args.slice(1) : args).filter((arg) => arg !== "--interactive"), list);
    return interactive ? "browser" : "help";
  }
  return "command";
}

export async function runVaultBrowser(args: string[], options: {
  vault: RunVaultCommandOptions; prompts: CliPrompts; report: (text: string) => void; color?: boolean;
}): Promise<void> {
  const listEntry = args[0] === "list";
  const base = (listEntry ? args.slice(1) : args).filter((arg) => arg !== "--interactive");
  validateOptions(base, listEntry);
  const copyOptions = (names: string[]): string[] => {
    const result: string[] = [];
    for (let i = 0; i < base.length; i++) {
      const flag = base[i];
      if (flag === "--keep") { if (names.includes(flag)) result.push(flag); continue; }
      const value = base[++i];
      if (names.includes(flag)) result.push(flag, value);
    }
    return result;
  };
  const adminArgs = copyOptions(listValues);
  const report = options.report;
  const vault = { ...options.vault, prompts: options.prompts, showReview: report };
  while (true) {
    const rows = await runVaultCommand(["list", ...adminArgs], vault) as readonly VaultBucket[];
    if (!rows.length) report("No vaults found.");
    // Menu values never alias operator-controlled identifiers.
    const selected = await options.prompts.select("Vaults", [
      ...rows.map((row, index) => ({ value: `vault:${index}`, label: row.vaultId, description: `${row.storage}; history ${row.history}; replicas ${row.replicas}` })),
      { value: "add", label: "Add new vault" }, { value: "exit", label: "Exit" },
    ]);
    if (selected === "exit") return;
    if (selected === "add") {
      await runVaultCommand(["add", ...base], vault);
      continue;
    }
    const selectedVault = rows[Number(selected.split(":")[1])];
    if (!selectedVault) throw new Error("VAULT_SELECTION_INVALID");
    const id = selectedVault.vaultId;
    const action = await options.prompts.select(id, [
      { value: "inspect", label: "Inspect" }, { value: "import", label: "Import to Obsidian", description: "Requires a retained credential (--keep)" },
      { value: "back", label: "Back" }, { value: "exit", label: "Exit" },
    ]);
    if (action === "exit") return;
    if (action === "back") continue;
    const current = await runVaultCommand(["inspect", "--vault-id", id, ...adminArgs], vault);
    if (!current) { report("Vault no longer exists. Refreshing list."); continue; }
    if (action === "inspect") report(formatVaultResult(current, options.color));
    else if (action === "import") {
      if (!vault.credentialStore?.readVault || !await vault.credentialStore.readVault(id)) {
        report("Import unavailable: no retained vault credential. Retention requires explicit --keep when adding or rotating.");
        continue;
      }
      if (!vault.renderHandoff) throw new Error("HANDOFF_ADAPTER_REQUIRED");
      await runImportCommand(["import", "--vault-id", id, ...copyOptions(["--secrets-output", "--wss-endpoint"])], {
        ...vault, credentialStore: vault.credentialStore, renderHandoff: vault.renderHandoff,
      });
    }
  }
}
