import { describe, expect, it, vi } from "vitest";
import { runBootstrap, runVaultCommand, type RunVaultCommandOptions } from "../../packages/server-cli/src/cli.js";
import { vaultEntry, runVaultBrowser } from "../../packages/server-cli/src/vault-browser.js";
import type { CliPrompts } from "../../packages/server-cli/src/prompts.js";

const host = { platform: () => ({ distribution: "debian", release: "13", architecture: "amd64" }) };
function prompts(): CliPrompts {
  return { select: vi.fn().mockResolvedValue("docker"), input: vi.fn().mockImplementation(async (message: string) => message.includes("domain") ? "sync.example.test" : message.includes("email") ? "" : "notes"),
    password: vi.fn().mockResolvedValue(""), confirm: vi.fn().mockResolvedValue(false) };
}
function vaultOptions(p = prompts()) {
  const users = { authenticate: vi.fn().mockResolvedValue(true), readAuthorization: vi.fn().mockResolvedValue({ administrator: { username: "fos-admin", passwordHash: "hash" }, users: [] }),
    validate: vi.fn(), write: vi.fn(), reload: vi.fn(), restore: vi.fn() };
  const admin = { authenticate: vi.fn().mockResolvedValue(true), listBuckets: vi.fn().mockResolvedValue([]), createBucket: vi.fn() };
  const options: RunVaultCommandOptions = { host, prompts: p, resolveMode: async () => "docker", createAdapter: () => users, createAdminAdapter: () => admin,
    credentialStore: { readAdministrator: async () => ({ kind: "administrator", username: "fos-admin", password: "fixture-only", endpoint: "wss://sync.example.test" }) },
    createVerificationAdapter: () => ({ authenticate: vi.fn().mockResolvedValue(true), status: vi.fn(), put: vi.fn(), get: vi.fn().mockResolvedValue(new TextEncoder().encode("fos-verify")), watch: vi.fn().mockResolvedValue(vi.fn()), crossBucketDenied: vi.fn() }),
    showReview: vi.fn(), discloseInteractiveSecrets: vi.fn(), renderHandoff: vi.fn().mockResolvedValue({ uri: "synthetic", qr: "synthetic" }), promptEncryptionPhrase: vi.fn().mockResolvedValue("") };
  return { options, users, admin, p };
}

describe("guided bootstrap", () => {
  it("uses typed choices and validates fields without applying a declined plan", async () => {
    const p = prompts(); const apply = vi.fn(); const showPreview = vi.fn();
    const result = await runBootstrap(["bootstrap"], { host, prompts: p, apply, showPreview });
    expect(result.applied).toBe(false); expect(apply).not.toHaveBeenCalled();
    expect(p.select).toHaveBeenCalledWith("Installation mode", expect.arrayContaining([expect.objectContaining({ value: "docker", description: expect.any(String) })]));
    const domain = vi.mocked(p.input).mock.calls.find(([message]) => message.includes("domain"))!;
    expect(domain[1]?.validate?.("bad domain")).not.toBe(true);
    expect(p.confirm).toHaveBeenLastCalledWith("Apply this plan?"); expect(showPreview).toHaveBeenCalledOnce();
  });
  it("rejects invalid supplied email before collecting missing values", async () => {
    const p = prompts();
    await expect(runBootstrap(["bootstrap", "--email", "invalid"], { host, prompts: p })).rejects.toThrow("EMAIL_INVALID");
    expect(p.input).not.toHaveBeenCalled();
  });
  it("skips supplied fields but still confirms interactive --approve", async () => {
    const p = prompts();
    await runBootstrap(["bootstrap", "--mode", "docker", "--domain", "sync.example.test", "--email", "ops@example.test", "--vault-id", "notes", "--approve", "--manage-firewall", "--dedicated-service-accounts"], { host, prompts: p });
    expect(p.select).not.toHaveBeenCalled(); expect(p.input).not.toHaveBeenCalled();
    expect(p.confirm).toHaveBeenLastCalledWith("Apply this plan?");
  });
});

describe("guided vault creation", () => {
  it("collects missing ID, preflights, reviews, and writes nothing on cancellation", async () => {
    const f = vaultOptions(); await runVaultCommand(["add"], f.options);
    expect(f.p.input).toHaveBeenCalled(); expect(f.admin.listBuckets).toHaveBeenCalled(); expect(f.users.readAuthorization).toHaveBeenCalled();
    expect(f.options.showReview).toHaveBeenCalledWith(expect.stringContaining("retention: one-time"));
    expect(f.users.write).not.toHaveBeenCalled(); expect(f.admin.createBucket).not.toHaveBeenCalled(); expect(f.options.promptEncryptionPhrase).not.toHaveBeenCalled();
  });
  it("fails authentication before asking for a phrase or writing", async () => {
    const f = vaultOptions(); f.users.authenticate.mockResolvedValue(false);
    await expect(runVaultCommand(["add", "--vault-id", "notes"], f.options)).rejects.toThrow("ADMIN_AUTH_REQUIRED");
    expect(f.options.promptEncryptionPhrase).not.toHaveBeenCalled(); expect(f.admin.createBucket).not.toHaveBeenCalled();
  });
  it("ensures the bucket before user write and honors protected output", async () => {
    const f = vaultOptions(); vi.mocked(f.p.confirm).mockResolvedValue(true);
    const output = { writeFileAtomically: vi.fn() }; f.options.secretOutput = output;
    await runVaultCommand(["add", "--vault-id", "notes", "--secrets-output", "/fixture/handoff"], f.options);
    expect(f.admin.createBucket).toHaveBeenCalledOnce(); expect(f.users.write).toHaveBeenCalledOnce();
    expect(f.admin.createBucket.mock.invocationCallOrder[0]).toBeLessThan(f.users.write.mock.invocationCallOrder[0]);
    expect(output.writeFileAtomically).toHaveBeenCalled(); expect(f.options.discloseInteractiveSecrets).not.toHaveBeenCalled();
  });
  it("requires protected output for JSON before access", async () => {
    const f = vaultOptions(); f.options.json = true;
    await expect(runVaultCommand(["add", "--vault-id", "notes"], f.options)).rejects.toThrow("VAULT_SECRETS_OUTPUT_REQUIRED");
    expect(f.users.authenticate).not.toHaveBeenCalled(); expect(f.p.confirm).not.toHaveBeenCalled();
  });

  it("preserves existing buckets and explicit retention", async () => {
    const f = vaultOptions(); vi.mocked(f.p.confirm).mockResolvedValue(true);
    f.admin.listBuckets.mockResolvedValue([{ name: "OBS_notes_FILES", vaultId: "notes", storage: "file", history: 10, replicas: 1 }]);
    const writeVault = vi.fn(); f.options.credentialStore!.writeVault = writeVault;
    await runVaultCommand(["add", "--vault-id", "notes", "--keep"], f.options);
    expect(f.admin.createBucket).not.toHaveBeenCalled(); expect(writeVault).toHaveBeenCalledOnce();
  });

  it("skips phrase collection for existing users and detects identifier collisions", async () => {
    const f = vaultOptions(); f.users.readAuthorization.mockResolvedValue({ administrator: {}, users: [{ vaultId: "notes", username: "fos-vault-notes" }] });
    await runVaultCommand(["add", "--vault-id", "notes"], f.options);
    expect(f.options.promptEncryptionPhrase).not.toHaveBeenCalled(); expect(f.p.confirm).not.toHaveBeenCalled();
    f.users.readAuthorization.mockResolvedValue({ administrator: {}, users: [{ vaultId: "other", username: "fos-vault-notes" }] });
    await expect(runVaultCommand(["add", "--vault-id", "notes"], f.options)).rejects.toThrow("VAULT_USER_COLLISION");
    expect(f.users.write).not.toHaveBeenCalled();
  });

  it("rechecks an existing-user race after review without creating a bucket", async () => {
    const f = vaultOptions(); vi.mocked(f.p.confirm).mockResolvedValue(true);
    f.users.readAuthorization.mockResolvedValueOnce({ users: [] }).mockResolvedValue({ users: [{ vaultId: "notes", username: "fos-vault-notes" }] });
    await runVaultCommand(["add", "--vault-id", "notes"], f.options);
    expect(f.admin.createBucket).not.toHaveBeenCalled(); expect(f.users.write).not.toHaveBeenCalled();
  });

  it("reports verification failure without delivering a handoff or deleting data", async () => {
    const f = vaultOptions(); vi.mocked(f.p.confirm).mockResolvedValue(true);
    f.options.createVerificationAdapter = () => ({ authenticate: vi.fn().mockResolvedValue(false), status: vi.fn(), put: vi.fn(), get: vi.fn(), watch: vi.fn(), crossBucketDenied: vi.fn() });
    await expect(runVaultCommand(["add", "--vault-id", "notes"], f.options)).rejects.toThrow();
    expect(f.users.write).toHaveBeenCalled(); expect(f.options.discloseInteractiveSecrets).not.toHaveBeenCalled();
  });

  it("does not confirm or collect phrases for fully specified unattended add", async () => {
    const f = vaultOptions(); f.options.unattended = true; f.options.secretOutput = { writeFileAtomically: vi.fn() };
    await runVaultCommand(["add", "--vault-id", "notes", "--secrets-output", "/fixture/handoff"], f.options);
    expect(f.p.confirm).not.toHaveBeenCalled(); expect(f.options.promptEncryptionPhrase).not.toHaveBeenCalled();
    await expect(runVaultCommand(["add", "--secrets-output", "/fixture/handoff"], f.options)).rejects.toThrow("VAULT_ID_REQUIRED");
  });
});

describe("vault browser routing", () => {
  it("preserves finite list and requires a terminal for the explicit browser", () => {
    expect(vaultEntry([], true)).toBe("browser"); expect(vaultEntry([], false)).toBe("help");
    expect(vaultEntry(["list"], true)).toBe("command");
    expect(() => vaultEntry(["list", "--interactive"], false)).toThrow("INTERACTIVE_TERMINAL_REQUIRED");
    expect(() => vaultEntry(["list", "--interactive", "--json"], true)).toThrow("INCOMPATIBLE_OUTPUT_OPTIONS");
    expect(() => vaultEntry(["--json"], true)).toThrow("UNKNOWN_BROWSER_OPTION");
  });
  it("handles an empty list and exits without mutation", async () => {
    const f = vaultOptions(); vi.mocked(f.p.select).mockResolvedValue("exit");
    const report = vi.fn(); await runVaultBrowser([], { vault: f.options, prompts: f.p, report });
    expect(report).toHaveBeenCalledWith("No vaults found."); expect(f.admin.createBucket).not.toHaveBeenCalled();
  });

  it("reports unavailable import and refreshes before the next choice", async () => {
    const f = vaultOptions();
    f.admin.listBuckets.mockResolvedValue([{ name: "OBS_notes_FILES", vaultId: "notes", storage: "file", history: 10, replicas: 1 }]);
    vi.mocked(f.p.select).mockResolvedValueOnce("vault:0").mockResolvedValueOnce("import").mockResolvedValueOnce("exit");
    const report = vi.fn(); await runVaultBrowser([], { vault: f.options, prompts: f.p, report });
    expect(report).toHaveBeenCalledWith(expect.stringContaining("Import unavailable"));
    expect(f.admin.listBuckets).toHaveBeenCalledTimes(3); expect(f.users.write).not.toHaveBeenCalled();
  });

  it("refreshes a stale vault instead of recreating it", async () => {
    const f = vaultOptions();
    f.admin.listBuckets.mockResolvedValueOnce([{ name: "OBS_notes_FILES", vaultId: "notes", storage: "file", history: 10, replicas: 1 }]).mockResolvedValue([]);
    vi.mocked(f.p.select).mockResolvedValueOnce("vault:0").mockResolvedValueOnce("inspect").mockResolvedValueOnce("exit");
    const report = vi.fn(); await runVaultBrowser([], { vault: f.options, prompts: f.p, report });
    expect(report).toHaveBeenCalledWith("Vault no longer exists. Refreshing list."); expect(f.admin.createBucket).not.toHaveBeenCalled();
  });

  it("imports a retained credential to the explicit protected destination", async () => {
    const f = vaultOptions();
    f.admin.listBuckets.mockResolvedValue([{ name: "OBS_notes_FILES", vaultId: "notes", storage: "file", history: 10, replicas: 1 }]);
    f.options.credentialStore!.readVault = vi.fn().mockResolvedValue({ kind: "vault", vaultId: "notes", username: "fos-vault-notes", password: "synthetic-vault-secret", endpoint: "wss://sync.example.test" });
    const output = { writeFileAtomically: vi.fn() }; f.options.secretOutput = output;
    vi.mocked(f.p.select).mockResolvedValueOnce("vault:0").mockResolvedValueOnce("import").mockResolvedValueOnce("exit");
    await runVaultBrowser(["--secrets-output", "/fixture/import", "--wss-endpoint", "wss://override.example.test"], { vault: f.options, prompts: f.p, report: vi.fn() });
    expect(f.options.renderHandoff).toHaveBeenCalledWith(expect.objectContaining({ vaultId: "notes", username: "fos-vault-notes", server: "wss://override.example.test" }));
    expect(output.writeFileAtomically).toHaveBeenCalledWith("/fixture/import", expect.any(String), { owner: 0, mode: 0o600 });
    expect(f.options.discloseInteractiveSecrets).not.toHaveBeenCalled(); expect(f.users.write).not.toHaveBeenCalled();
  });

  it("shares guided creation and refreshes the successfully created vault", async () => {
    const f = vaultOptions(); const buckets: unknown[] = [];
    f.admin.listBuckets.mockImplementation(async () => buckets);
    f.admin.createBucket.mockImplementation(async (bucket) => { buckets.push(bucket); });
    vi.mocked(f.p.confirm).mockResolvedValue(true);
    vi.mocked(f.p.select).mockResolvedValueOnce("add").mockResolvedValueOnce("exit");
    const writeVault = vi.fn(); f.options.credentialStore!.writeVault = writeVault;
    f.options.secretOutput = { writeFileAtomically: vi.fn() };
    await runVaultBrowser(["--keep", "--secrets-output", "/fixture/new"], { vault: f.options, prompts: f.p, report: vi.fn() });
    expect(f.p.select).toHaveBeenLastCalledWith("Vaults", expect.arrayContaining([expect.objectContaining({ label: "notes" })]));
    expect(writeVault).toHaveBeenCalledOnce(); expect(f.options.discloseInteractiveSecrets).not.toHaveBeenCalled();
  });
});
