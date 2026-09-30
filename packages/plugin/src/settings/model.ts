import type { SyncStatus } from "../connection.js";
import type { TransferConfig } from "../config-transfer.js";
import type { ConflictHistoryEntry, ConflictRecord } from "../local-store.js";
import { validateSettingsDraft, type SettingsValidationErrors } from "../settings-validation.js";

export interface EasySyncSettings {
  vaultId: string;
  boundVaultId: string;
  deviceId: string;
  server: string;
  username: string;
  passwordSecretKey: string;
  s3Endpoint: string;
  s3Bucket: string;
  s3Region: string;
  s3AccessKeyId: string;
  s3SecretKeySecretKey: string;
  inlineLimit: number;
  debugLogging: boolean;
  statusBarMode: "minimal" | "extended";
}

export type SettingsSection = "sync" | "server" | "advanced";

export const SETTINGS_SECTIONS: ReadonlyArray<readonly [SettingsSection, string]> = [
  ["sync", "Sync"], ["server", "Server"], ["advanced", "Advanced"],
];
export type SettingsApplyResult =
  | { kind: "applied" }
  | { kind: "not-configured" }
  | { kind: "validation-error"; errors: SettingsValidationErrors }
  | { kind: "persistence-error"; message: string }
  | { kind: "connection-error"; message: string };

export type ConflictComparison = {
  remote: Record<string, unknown>;
  local: Record<string, unknown>;
  stale: { remote: boolean; local: boolean };
};

export interface SettingsDraft extends EasySyncSettings {
  natsPassword: string;
  s3Secret: string;
  attachmentsEnabled: boolean;
}

export function attachmentsEnabledFor(settings: EasySyncSettings): boolean {
  return Boolean(settings.s3Endpoint || settings.s3Bucket || settings.s3AccessKeyId || settings.s3SecretKeySecretKey ||
    (settings.s3Region && settings.s3Region !== "us-east-1"));
}

export function draftFor(settings: EasySyncSettings): SettingsDraft {
  return { ...settings, natsPassword: "", s3Secret: "", attachmentsEnabled: attachmentsEnabledFor(settings) };
}

/** True once any connection value exists, matching when the plugin attempts a connection. */
export function connectionConfigured(settings: EasySyncSettings): boolean {
  return Boolean(settings.server || settings.username || settings.passwordSecretKey);
}

export type ServerChangeKey = "vaultId" | "server" | "username" | "password" | "attachments" |
  "s3Endpoint" | "s3Bucket" | "s3Region" | "s3AccessKeyId" | "s3Secret";

/** Fields of the staged Server draft that differ from saved settings, in display order. */
export function serverChanges(draft: SettingsDraft, saved: EasySyncSettings): Array<{ key: ServerChangeKey; label: string }> {
  const changes: Array<{ key: ServerChangeKey; label: string }> = [];
  const add = (changed: boolean, key: ServerChangeKey, label: string): void => { if (changed) changes.push({ key, label }); };
  add(draft.vaultId !== saved.vaultId, "vaultId", "Vault ID");
  add(draft.server !== saved.server, "server", "Server address");
  add(draft.username !== saved.username, "username", "Username");
  add(Boolean(draft.natsPassword), "password", "Password");
  const savedAttachments = attachmentsEnabledFor(saved);
  add(draft.attachmentsEnabled !== savedAttachments, "attachments", "Attachment storage");
  // Turning storage off discards its fields, so only the switch itself counts as a change.
  if (!draft.attachmentsEnabled) return changes;
  add(draft.s3Endpoint !== saved.s3Endpoint, "s3Endpoint", "Endpoint");
  add(draft.s3Bucket !== saved.s3Bucket, "s3Bucket", "Bucket");
  add(draft.s3Region !== saved.s3Region, "s3Region", "Region");
  add(draft.s3AccessKeyId !== saved.s3AccessKeyId, "s3AccessKeyId", "Access key ID");
  add(Boolean(draft.s3Secret), "s3Secret", "Secret access key");
  return changes;
}

export function validateDraft(draft: SettingsDraft, passwordAvailable: boolean, s3SecretAvailable: boolean, requireConnection = false) {
  return validateSettingsDraft({
    vaultId: draft.vaultId,
    server: draft.server,
    username: draft.username,
    hasPassword: Boolean(draft.natsPassword || (draft.passwordSecretKey && passwordAvailable)),
    attachmentsEnabled: draft.attachmentsEnabled,
    s3Endpoint: draft.s3Endpoint,
    s3Bucket: draft.s3Bucket,
    s3Region: draft.s3Region,
    s3AccessKeyId: draft.s3AccessKeyId,
    hasS3Secret: Boolean(draft.s3Secret || (draft.s3SecretKeySecretKey && s3SecretAvailable)),
    inlineLimitKiB: draft.inlineLimit / 1024,
  }, requireConnection);
}

export type AdvancedUpdate = Partial<Pick<EasySyncSettings, "inlineLimit" | "debugLogging" | "statusBarMode">>;

/** The narrow plugin surface the settings UI depends on. */
export interface SettingsHost {
  readonly config: EasySyncSettings;
  readonly status: SyncStatus;
  safeDiagnostic(error: unknown, additionalSecrets?: string[]): string;
  applyDraft(draft: SettingsDraft | ((settings: EasySyncSettings) => SettingsDraft), section: SettingsSection | "all"): Promise<SettingsApplyResult>;
  applyAdvancedUpdate(update: AdvancedUpdate): Promise<SettingsApplyResult>;
  connectNow(): Promise<SettingsApplyResult>;
  /** Reconcile now when connected, otherwise start a connection attempt. */
  syncNow(): Promise<void>;
  /** Redacted plain-text status for bug reports. */
  statusReport(): string;
  exportConfig(phrase: string): Promise<string>;
  importConfig(transfer: TransferConfig): Promise<SettingsApplyResult>;
  getConflicts(): Promise<ConflictRecord[]>;
  getConflictHistory(): Promise<ConflictHistoryEntry[]>;
  createConflictReview(operationId: string): Promise<string>;
  keepRemote(operationId: string): Promise<void>;
  keepLocalCopy(operationId: string): Promise<void>;
  markConflictResolved(operationId: string): Promise<void>;
}
