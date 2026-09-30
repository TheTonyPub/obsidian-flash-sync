import { EditorView } from "@codemirror/view";
import { App, MarkdownView, Notice, Platform, Plugin, TFile, setIcon } from "obsidian";
import { normalizePath } from "@flash-osidian-sync/protocol";
import { connectExistingNatsBucket, connectVault, SyncStatus, type KvPort } from "./connection.js";
import { LocalStore } from "./local-store.js";
import { MarkdownSyncEngine, type MarkdownVault } from "./markdown-sync.js";
import { CONFLICT_REVIEW_FOLDER, formatConflictReviewNote } from "./conflict-review-note.js";
import { connectS3Blob, DEFAULT_INLINE_LIMIT, type BlobPort } from "./blob-storage.js";
import { buildStatusReport, createLogger, errorSummary } from "./diagnostics.js";
import { encryptTransfer, type TransferConfig } from "./config-transfer.js";
import { PLUGIN_ID, registerImportUriHandlers } from "./plugin-identity.js";
import type { SettingsField, SettingsValidationErrors } from "./settings-validation.js";
import type { ConflictHistoryEntry, ConflictRecord } from "./local-store.js";
import { statusPresentation } from "./status-presentation.js";
import { draftFor, validateDraft, type AdvancedUpdate, type ConflictComparison, type EasySyncSettings,
  type SettingsApplyResult, type SettingsDraft, type SettingsHost, type SettingsSection } from "./settings/model.js";
import { EasySyncSettingTab } from "./settings/tab.js";
import { ImportConfigModal } from "./settings/transfer-modals.js";

function validIncluded(path: string): boolean {
  if (path === CONFLICT_REVIEW_FOLDER || path.startsWith(`${CONFLICT_REVIEW_FOLDER}/`)) return false;
  try { return normalizePath(path) === path; }
  catch { return false; }
}

class ObsidianMarkdownVault implements MarkdownVault {
  constructor(private readonly app: App) {}

  async read(path: string): Promise<Uint8Array | undefined> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return undefined;
    return new Uint8Array(await this.app.vault.readBinary(file));
  }

  async listMarkdown(): Promise<Array<{ path: string; content: string }>> {
    const files = this.app.vault.getMarkdownFiles().filter((file) => validIncluded(file.path));
    return Promise.all(files.map(async (file) => ({ path: file.path, content: await this.app.vault.read(file) })));
  }

  async listFiles(): Promise<Array<{ path: string; bytes: Uint8Array }>> {
    return Promise.all(this.app.vault.getFiles().filter((file) => validIncluded(file.path))
      .map(async (file) => ({ path: file.path, bytes: new Uint8Array(await this.app.vault.readBinary(file)) })));
  }

  async write(path: string, bytes: Uint8Array): Promise<void> {
    const markdown = path.endsWith(".md");
    const content = markdown ? new TextDecoder("utf-8", { fatal: true }).decode(bytes) : undefined;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      if (markdown) await this.app.vault.modify(file, content!);
      else await this.app.vault.modifyBinary(file, bytes.slice().buffer as ArrayBuffer);
      return;
    }
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) {
      const folder = parts.slice(0, i).join("/");
      if (!this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
    }
    if (markdown) await this.app.vault.create(path, content!);
    else await this.app.vault.createBinary(path, bytes.slice().buffer as ArrayBuffer);
  }

  onModify(listener: (path: string) => void): () => void {
    const reference = this.app.vault.on("modify", (file) => {
      if (file instanceof TFile && validIncluded(file.path)) listener(file.path);
    });
    const created = this.app.vault.on("create", (file) => {
      if (file instanceof TFile && validIncluded(file.path)) listener(file.path);
    });
    return () => { this.app.vault.offref(reference); this.app.vault.offref(created); };
  }

  async rename(from: string, to: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(from);
    if (!(file instanceof TFile)) throw new Error("File to rename is missing");
    const parts = to.split("/");
    for (let i = 1; i < parts.length; i++) {
      const folder = parts.slice(0, i).join("/");
      if (!this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
    }
    await this.app.fileManager.renameFile(file, to);
  }

  async remove(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) await this.app.vault.trash(file, false);
  }

  onRename(listener: (from: string, to: string) => void): () => void {
    const reference = this.app.vault.on("rename", (file, oldPath) => {
      if (file instanceof TFile && validIncluded(oldPath) && validIncluded(file.path)) listener(oldPath, file.path);
    });
    return () => this.app.vault.offref(reference);
  }

  onDelete(listener: (path: string) => void): () => void {
    const reference = this.app.vault.on("delete", (file) => {
      if (file instanceof TFile && validIncluded(file.path)) listener(file.path);
    });
    return () => this.app.vault.offref(reference);
  }
}

export default class EasySyncPlugin extends Plugin implements SettingsHost {
  config!: EasySyncSettings;
  private engine?: MarkdownSyncEngine;
  private store?: LocalStore;
  private kv?: KvPort;
  private blob?: BlobPort;
  private settingsTab?: EasySyncSettingTab;
  readonly status = new SyncStatus();
  private operationQueue: Promise<void> = Promise.resolve();
  private lastReconciledAt = 0;
  private hiddenAt = 0;
  private initialReconcileInFlight = false;
  private connectionAttempt?: Promise<SettingsApplyResult>;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private automaticAttempts = 0;
  private automaticRetryBlocked = false;
  private connectionGeneration = 0;
  private unloading = false;
  private static readonly maxAutomaticAttempts = 5;
  private static readonly retryBaseDelayMs = 1_000;
  private static readonly retryDelayCapMs = 15_000;
  private static readonly desktopVisibilityReconcileAfterMs = 5 * 60 * 1000;
  private readonly logger = createLogger(() => this.config?.debugLogging ?? false, console,
    (message) => this.redactDiagnostic(message));

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation, operation);
    this.operationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  private redactDiagnostic(message: string, additionalSecrets: string[] = []): string {
    let result = message;
    for (const key of [this.config?.passwordSecretKey, this.config?.s3SecretKeySecretKey]) {
      if (!key) continue;
      try {
        const secret = this.app.secretStorage.getSecret(key);
        if (secret) result = result.replaceAll(secret, "[redacted]");
      } catch { /* Keep diagnostics safe when SecretStorage is unavailable. */ }
    }
    for (const secret of additionalSecrets) if (secret) result = result.replaceAll(secret, "[redacted]");
    return result;
  }

  safeDiagnostic(error: unknown, additionalSecrets: string[] = []): string {
    return this.redactDiagnostic(errorSummary(error), additionalSecrets).replace(/[\r\n\t]+/g, " ").slice(0, 220);
  }

  async onload(): Promise<void> {
    const saved = (await this.loadData()) as Partial<EasySyncSettings> | null;
    this.config = {
      vaultId: saved?.vaultId || crypto.randomUUID().replaceAll("-", "").toUpperCase(),
      boundVaultId: saved?.boundVaultId ?? "",
      deviceId: saved?.deviceId ?? crypto.randomUUID(),
      server: saved?.server ?? "",
      username: saved?.username ?? "",
      passwordSecretKey: saved?.passwordSecretKey ?? "",
      s3Endpoint: saved?.s3Endpoint ?? "",
      s3Bucket: saved?.s3Bucket ?? "",
      s3Region: saved?.s3Region ?? "us-east-1",
      s3AccessKeyId: saved?.s3AccessKeyId ?? "",
      s3SecretKeySecretKey: saved?.s3SecretKeySecretKey ?? "",
      inlineLimit: saved?.inlineLimit ?? DEFAULT_INLINE_LIMIT,
      debugLogging: saved?.debugLogging ?? false,
      statusBarMode: saved?.statusBarMode ?? "extended",
    };
    await this.saveSettings();
    const statusBar = this.addStatusBarItem();
    const renderStatusBar = (): void => {
      const presentation = statusPresentation(this.status);
      statusBar.empty();
      statusBar.classList.remove("flash-sync-status-neutral", "flash-sync-status-success", "flash-sync-status-error", "flash-sync-status-muted", "flash-sync-status-warning");
      statusBar.classList.add("flash-sync-status", `flash-sync-status-${presentation.color}`);
      statusBar.style.color = { neutral: "var(--text-normal)", success: "var(--text-success)", error: "var(--text-error)",
        muted: "var(--text-muted)", warning: "var(--text-warning)" }[presentation.color];
      statusBar.setAttribute("aria-label", presentation.label);
      statusBar.setAttribute("title", presentation.tooltip);
      statusBar.setAttribute("role", "button");
      statusBar.tabIndex = 0;
      const icon = statusBar.createSpan({ cls: "flash-sync-status-icon", attr: { "aria-hidden": "true" } });
      setIcon(icon, presentation.icon);
      if (this.config.statusBarMode === "extended") statusBar.createSpan({ text: ` ${presentation.text}`, cls: "flash-sync-status-text" });
    };
    statusBar.addEventListener("click", () => this.openStatusOverview());
    statusBar.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); this.openStatusOverview(); }
    });
    this.register(this.status.subscribe(renderStatusBar));
    renderStatusBar();
    this.settingsTab = new EasySyncSettingTab(this.app, this);
    this.addSettingTab(this.settingsTab);
    registerImportUriHandlers(((scheme, handler) => {
      this.registerObsidianProtocolHandler(scheme, handler as never);
    }), (data) => {
      new ImportConfigModal(this.app, this, data).open();
    });
    this.registerEditorExtension(EditorView.updateListener.of((update) => {
      if (!update.docChanged || !this.engine) return;
      const file = this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
      if (file && validIncluded(file.path) && file.path.endsWith(".md")) this.engine.scheduleCapture(file.path, update.state.doc.toString());
    }));
    this.app.workspace.onLayoutReady(() => { this.requestAutomaticConnection("startup"); });
    this.registerDomEvent(document, "visibilitychange", () => {
      if (document.hidden) {
        this.hiddenAt = Date.now();
      } else if (this.shouldReconcileOnVisibility()) {
        this.requestLifecycleConnection("resume");
      } else {
        this.logger.debug("reconcile.visibility_skipped", { connected: this.status.connected, reconciled: this.status.reconciled });
      }
    });
    this.registerDomEvent(window, "online", () => { this.requestLifecycleConnection("online"); });
  }

  async onunload(): Promise<void> {
    this.unloading = true;
    this.connectionGeneration++;
    this.clearRetryTimer();
    this.status.retrying = false;
    await this.operationQueue;
    await this.disconnect();
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.config);
  }

  private openStatusOverview(): void {
    const setting = (this.app as App & { setting?: { open: () => void; openTabById: (id: string) => void } }).setting;
    setting?.open();
    setting?.openTabById(PLUGIN_ID);
  }

  async exportConfig(phrase: string): Promise<string> {
    const settings = this.config;
    const natsPassword = this.app.secretStorage.getSecret(settings.passwordSecretKey);
    if (!natsPassword) throw new Error("NATS password is missing from SecretStorage");
    const s3SecretKey = settings.s3SecretKeySecretKey
      ? this.app.secretStorage.getSecret(settings.s3SecretKeySecretKey) : "";
    if (settings.s3Endpoint && !s3SecretKey) throw new Error("S3 secret key is missing from SecretStorage");
    const transfer: TransferConfig = {
      vaultId: settings.vaultId, server: settings.server, username: settings.username, natsPassword,
      s3Endpoint: settings.s3Endpoint, s3Bucket: settings.s3Bucket, s3Region: settings.s3Region,
      s3AccessKeyId: settings.s3AccessKeyId, s3SecretKey: s3SecretKey ?? "", inlineLimit: settings.inlineLimit,
    };
    return encryptTransfer(transfer, phrase);
  }

  async importConfig(transfer: TransferConfig): Promise<SettingsApplyResult> {
    if (this.config.boundVaultId && this.config.boundVaultId !== transfer.vaultId) {
      throw new Error("This device is bound to a different vault");
    }
    const draft = draftFor(this.config);
    Object.assign(draft, {
      vaultId: transfer.vaultId, server: transfer.server, username: transfer.username,
      s3Endpoint: transfer.s3Endpoint, s3Bucket: transfer.s3Bucket, s3Region: transfer.s3Region,
      s3AccessKeyId: transfer.s3AccessKeyId, inlineLimit: transfer.inlineLimit,
      natsPassword: transfer.natsPassword, s3Secret: transfer.s3SecretKey,
      attachmentsEnabled: Boolean(transfer.s3Endpoint || transfer.s3Bucket || transfer.s3AccessKeyId || transfer.s3SecretKey),
    });
    return this.applyDraft(draft, "all");
  }

  async applyDraft(draft: SettingsDraft | ((settings: EasySyncSettings) => SettingsDraft), section: SettingsSection | "all"): Promise<SettingsApplyResult> {
    const submittedSnapshot = typeof draft === "function" ? undefined : { ...draft };
    const draftFactory = typeof draft === "function" ? draft : undefined;
    return this.serialize(async () => {
      const submittedDraft = submittedSnapshot ?? draftFactory!(this.config);
      if (this.config.boundVaultId && this.config.boundVaultId !== submittedDraft.vaultId) {
        return { kind: "validation-error", errors: { vaultId: "This device is bound to a different vault." } };
      }
      const previous = this.config;
      const candidate = draftFor(previous);
      // Server stages connection and attachment storage as one draft and reconnects once.
      const serverFields = section === "server" || section === "all";
      const advancedFields = section === "advanced" || section === "all";
      if (serverFields) {
        Object.assign(candidate, { vaultId: submittedDraft.vaultId, server: submittedDraft.server,
          username: submittedDraft.username, natsPassword: submittedDraft.natsPassword,
          attachmentsEnabled: Boolean(submittedDraft.attachmentsEnabled) });
        // Attachment fields count only while storage is switched on; switched off, they are cleared.
        Object.assign(candidate, submittedDraft.attachmentsEnabled
          ? { s3Endpoint: submittedDraft.s3Endpoint, s3Bucket: submittedDraft.s3Bucket, s3Region: submittedDraft.s3Region,
            s3AccessKeyId: submittedDraft.s3AccessKeyId, s3Secret: submittedDraft.s3Secret }
          : { s3Endpoint: "", s3Bucket: "", s3Region: "us-east-1", s3AccessKeyId: "", s3Secret: "", s3SecretKeySecretKey: "" });
      }
      if (advancedFields) Object.assign(candidate, { inlineLimit: submittedDraft.inlineLimit, debugLogging: submittedDraft.debugLogging,
        statusBarMode: submittedDraft.statusBarMode });
      const passwordAvailable = Boolean(candidate.natsPassword || (candidate.passwordSecretKey &&
        this.app.secretStorage.getSecret(candidate.passwordSecretKey)));
      const s3SecretAvailable = Boolean(candidate.s3Secret || (candidate.s3SecretKeySecretKey &&
        this.app.secretStorage.getSecret(candidate.s3SecretKeySecretKey)));
      const validation = validateDraft(candidate, Boolean(passwordAvailable), Boolean(s3SecretAvailable), serverFields);
      const server: SettingsField[] = ["vaultId", "server", "username", "hasPassword",
        "s3Endpoint", "s3Bucket", "s3Region", "s3AccessKeyId", "hasS3Secret"];
      const scopedFields: Record<typeof section, SettingsField[]> = {
        sync: [], server, advanced: ["inlineLimitKiB"], all: [...server, "inlineLimitKiB"],
      };
      const errors = Object.fromEntries(Object.entries(validation.errors)
        .filter(([field]) => scopedFields[section].includes(field as SettingsField))) as SettingsValidationErrors;
      if (Object.keys(errors).length) return { kind: "validation-error", errors };
      candidate.inlineLimit = validation.inlineLimit;

      const next: EasySyncSettings = { ...previous };
      if (serverFields) Object.assign(next, { vaultId: candidate.vaultId, server: candidate.server,
        username: candidate.username, s3Endpoint: candidate.s3Endpoint, s3Bucket: candidate.s3Bucket,
        s3Region: candidate.s3Region, s3AccessKeyId: candidate.s3AccessKeyId });
      if (advancedFields) Object.assign(next, { inlineLimit: candidate.inlineLimit, debugLogging: candidate.debugLogging,
        statusBarMode: candidate.statusBarMode });
      try {
        if (serverFields && candidate.natsPassword) {
          next.passwordSecretKey = `${PLUGIN_ID}-nats-${crypto.randomUUID()}`;
          this.app.secretStorage.setSecret(next.passwordSecretKey, candidate.natsPassword);
        }
        if (serverFields && validation.attachmentsConfigured && candidate.s3Secret) {
          next.s3SecretKeySecretKey = `${PLUGIN_ID}-s3-${crypto.randomUUID()}`;
          this.app.secretStorage.setSecret(next.s3SecretKeySecretKey, candidate.s3Secret);
        } else if (serverFields && !validation.attachmentsConfigured) {
          next.s3SecretKeySecretKey = "";
        }
        this.config = next;
        await this.saveData(next);
      } catch (error) {
        this.config = previous;
        return { kind: "persistence-error", message: this.safeDiagnostic(error, [candidate.natsPassword, candidate.s3Secret]) };
      }
      this.config = next;
      this.settingsTab?.onApplied(next, section);
      if (previous.statusBarMode !== next.statusBarMode) this.status.refresh();

      const reconnectFields: Array<keyof EasySyncSettings> = ["vaultId", "server", "username", "passwordSecretKey",
        "s3Endpoint", "s3Bucket", "s3Region", "s3AccessKeyId", "s3SecretKeySecretKey", "inlineLimit"];
      const reconnectNeeded = reconnectFields.some((field) => previous[field] !== next[field]);
      if (serverFields && !validation.attachmentsConfigured) {
        this.status.attachmentState = "NOT_CONFIGURED";
        this.status.attachmentError = "";
      } else if (serverFields && validation.attachmentsConfigured && reconnectNeeded) {
        this.status.attachmentState = "CONFIGURED";
        this.status.attachmentError = "";
      }
      if (!reconnectNeeded) return { kind: "applied" };
      this.resetAutomaticRetries(true);
      if (serverFields && !validation.configured) {
        this.automaticRetryBlocked = true;
        await this.disconnect();
        this.status.connectionState = "UNCONFIGURED";
        this.status.connectionError = "";
        this.status.connected = false;
        this.status.refresh();
        return { kind: "not-configured" };
      }
      const generation = this.connectionGeneration;
      const result = await this.connectNowUnlocked();
      if (this.status.connectionState === "AUTH_ERROR" || result.kind === "validation-error" || result.kind === "not-configured") {
        this.automaticRetryBlocked = true;
        this.automaticAttempts = 0;
      } else if (result.kind === "connection-error" && this.status.connectionState === "OFFLINE") {
        this.automaticAttempts = 1;
        this.scheduleAutomaticRetry(generation);
      }
      return result.kind === "connection-error" || result.kind === "validation-error" ? result : { kind: "applied" };
    });
  }

  async applyAdvancedUpdate(update: AdvancedUpdate): Promise<SettingsApplyResult> {
    return this.applyDraft((settings) => ({ ...draftFor(settings), ...update }), "advanced");
  }

  async syncNow(): Promise<void> {
    if (this.engine && this.status.connected) await this.reconcileAfter("manual");
    else await this.connectNow();
  }

  statusReport(): string {
    return buildStatusReport(this.status, this.config, {
      pluginVersion: this.manifest?.version ?? "unknown",
      platform: Platform.isMobile ? "mobile" : "desktop",
      redact: (message) => this.redactDiagnostic(message),
    });
  }

  private reconcileAfter(trigger: string): Promise<void> {
    if (!this.engine) return Promise.resolve();
    this.logger.debug("reconcile.trigger", { trigger });
    const startedAt = performance.now();
    return this.engine.reconcile().then(() => {
      this.lastReconciledAt = Date.now();
      this.logger.debug("reconcile.trigger_complete", { trigger, durationMs: Math.round(performance.now() - startedAt) });
    }).catch((error: unknown) => {
      this.status.lastError = errorSummary(error);
      this.status.refresh();
      this.logger.error("reconcile.trigger_failed", error, { trigger });
    });
  }

  private requestLifecycleConnection(trigger: "online" | "resume"): void {
    if (this.engine && this.status.connected) {
      void this.reconcileAfter(trigger);
      return;
    }
    if (this.connectionAttempt) return;
    // A connectivity or resume signal starts a fresh bounded series and can
    // replace a delayed retry with an immediate attempt.
    this.resetAutomaticRetries();
    this.requestAutomaticConnection(trigger);
  }

  private requestAutomaticConnection(trigger: string): void {
    if (this.unloading || this.connectionAttempt) return;
    if (this.retryTimer) return;
    void this.startConnectionAttempt(trigger);
  }

  private startConnectionAttempt(trigger: string): Promise<SettingsApplyResult> {
    if (this.unloading) return Promise.resolve({ kind: "not-configured" });
    if (this.connectionAttempt) return this.connectionAttempt;
    if (this.automaticRetryBlocked) {
      return Promise.resolve({ kind: "connection-error", message: this.status.connectionError });
    }
    if (this.automaticAttempts >= EasySyncPlugin.maxAutomaticAttempts) {
      this.status.retrying = false;
      this.status.refresh();
      return Promise.resolve({ kind: "connection-error", message: this.status.connectionError });
    }

    this.automaticAttempts++;
    const generation = this.connectionGeneration;
    this.status.retrying = false;
    this.status.refresh();
    const attempt = this.serialize(() => this.connectNowUnlocked());
    this.connectionAttempt = attempt;
    void attempt.then((result) => {
      if (generation !== this.connectionGeneration || this.unloading) return;
      if (this.status.connectionState === "AUTH_ERROR" || result.kind === "validation-error" || result.kind === "not-configured") {
        this.automaticRetryBlocked = true;
        this.automaticAttempts = 0;
        this.status.retrying = false;
        this.status.refresh();
      } else if (result.kind === "connection-error" && this.status.connectionState === "OFFLINE") {
        this.scheduleAutomaticRetry(generation);
      } else {
        this.status.retrying = false;
        if (result.kind !== "connection-error") this.automaticAttempts = 0;
        this.status.refresh();
      }
      this.logger.debug("plugin.connect.attempt_complete", { trigger, result: result.kind,
        attempts: this.automaticAttempts });
    }).finally(() => {
      if (this.connectionAttempt === attempt) this.connectionAttempt = undefined;
    });
    return attempt;
  }

  private scheduleAutomaticRetry(generation: number): void {
    if (this.automaticAttempts >= EasySyncPlugin.maxAutomaticAttempts || this.unloading || generation !== this.connectionGeneration) {
      this.status.retrying = false;
      this.status.refresh();
      return;
    }
    const delay = Math.min(EasySyncPlugin.retryBaseDelayMs * 2 ** (this.automaticAttempts - 1),
      EasySyncPlugin.retryDelayCapMs);
    this.status.retrying = true;
    this.status.refresh();
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      void this.startConnectionAttempt("retry");
    }, delay);
    this.logger.debug("plugin.connect.retry_scheduled", { attempt: this.automaticAttempts + 1, delayMs: delay });
  }

  private clearRetryTimer(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
  }

  private resetAutomaticRetries(allowBlocked = false): void {
    this.connectionGeneration++;
    this.clearRetryTimer();
    this.automaticAttempts = 0;
    if (allowBlocked) this.automaticRetryBlocked = false;
    this.status.retrying = false;
    this.status.refresh();
  }

  private shouldReconcileOnVisibility(): boolean {
    if (Platform.isMobile) return true;
    if (this.initialReconcileInFlight) return false;
    if (!this.engine || !this.status.connected || !this.status.reconciled) return true;
    const hiddenForMs = this.hiddenAt ? Date.now() - this.hiddenAt : 0;
    return hiddenForMs >= EasySyncPlugin.desktopVisibilityReconcileAfterMs ||
      Date.now() - this.lastReconciledAt >= EasySyncPlugin.desktopVisibilityReconcileAfterMs;
  }

  private async disconnect(): Promise<void> {
    this.initialReconcileInFlight = false;
    this.engine?.stop();
    await this.engine?.settle();
    this.engine = undefined;
    await this.kv?.close?.();
    this.kv = undefined;
    this.store?.close();
    this.store = undefined;
    this.blob = undefined;
  }

  async connectNow(): Promise<SettingsApplyResult> {
    this.resetAutomaticRetries(true);
    const generation = this.connectionGeneration;
    return this.serialize(async () => {
      const result = await this.connectNowUnlocked();
      if (this.status.connectionState === "AUTH_ERROR" || result.kind === "validation-error" || result.kind === "not-configured") {
        this.automaticRetryBlocked = true;
        this.automaticAttempts = 0;
      } else if (result.kind === "connection-error" && this.status.connectionState === "OFFLINE" && generation === this.connectionGeneration) {
        this.automaticAttempts = 1;
        this.scheduleAutomaticRetry(generation);
      }
      return result;
    });
  }

  private async connectNowUnlocked(): Promise<SettingsApplyResult> {
    const startedAt = performance.now();
    const config = this.config;
    const draft = draftFor(config);
    const validation = validateDraft(draft, Boolean(config.passwordSecretKey && this.app.secretStorage.getSecret(config.passwordSecretKey)),
      Boolean(config.s3SecretKeySecretKey && this.app.secretStorage.getSecret(config.s3SecretKeySecretKey)));
    const connectionStarted = Boolean(config.server || config.username || config.passwordSecretKey);
    if (!connectionStarted) {
      this.status.connectionState = "UNCONFIGURED";
      this.status.connectionError = "";
      this.status.connected = false;
      this.status.refresh();
      return { kind: "not-configured" };
    }
    const connectionErrors = ["vaultId", "server", "username", "hasPassword"] as SettingsField[];
    const invalidConnection = connectionErrors.some((field) => validation.errors[field]);
    if (invalidConnection || validation.errors.inlineLimitKiB) {
      this.status.connectionState = "OFFLINE";
      this.status.connectionError = this.redactDiagnostic(Object.values(validation.errors).find(Boolean) ?? "Invalid connection settings.");
      this.status.connected = false;
      this.status.refresh();
      return { kind: "validation-error", errors: validation.errors };
    }
    const attachmentError = validation.errors.s3Endpoint || validation.errors.s3Bucket || validation.errors.s3Region ||
      validation.errors.s3AccessKeyId || validation.errors.hasS3Secret;
    if (attachmentError) {
      this.status.attachmentState = "CONFIGURATION_ERROR";
      this.status.attachmentError = attachmentError;
    }
    this.status.value = "INITIALIZING";
    this.status.connectionState = "CONNECTING";
    this.status.connectionError = "";
    this.status.connected = false;
    this.status.reconciled = false;
    this.status.refresh();
    await this.disconnect();
    this.status.lastError = "";
    this.logger.debug("plugin.connect.start", { vaultId: config.vaultId, bucket: `OBS_${config.vaultId}_FILES` });
    if (config.boundVaultId && config.boundVaultId !== config.vaultId) {
      new Notice(`${PLUGIN_ID}: vault binding cannot be changed`);
      return { kind: "validation-error", errors: { vaultId: "This device is bound to a different vault." } };
    }
    try {
      const kv = await connectVault({
        vaultId: config.vaultId, bucket: `OBS_${config.vaultId}_FILES`, server: config.server,
        username: config.username, passwordSecretKey: config.passwordSecretKey,
      }, { getSecret: async (key) => this.app.secretStorage.getSecret(key) },
      (options, bucket, status) => connectExistingNatsBucket(options, bucket, status, this.logger), this.status);
      this.logger.debug("plugin.connect.wss_complete", { durationMs: Math.round(performance.now() - startedAt) });
      this.kv = kv;
      const storeStartedAt = performance.now();
      const store = await LocalStore.open(`${PLUGIN_ID}-${config.deviceId}-${config.vaultId}`);
      this.logger.debug("plugin.connect.store_open_complete", { durationMs: Math.round(performance.now() - storeStartedAt) });
      this.store = store;
      if (validation.attachmentsConfigured) {
        try {
          this.blob = await connectS3Blob({ endpoint: config.s3Endpoint, bucket: config.s3Bucket,
            region: config.s3Region, accessKeyId: config.s3AccessKeyId,
            secretKeySecretKey: config.s3SecretKeySecretKey }, this.app.secretStorage);
          this.status.clearError("s3-config");
          this.status.attachmentState = "CONFIGURED";
          this.status.attachmentError = "";
        } catch (error) {
          this.status.markError("s3-config");
          this.status.attachmentState = "CONFIGURATION_ERROR";
          this.status.attachmentError = this.redactDiagnostic(errorSummary(error));
          this.status.lastError = this.status.attachmentError;
          this.logger.error("s3.connect_failed", error);
          new Notice(`${PLUGIN_ID} S3: ${this.status.lastError}`);
        }
      }
      const engine = new MarkdownSyncEngine({ deviceId: config.deviceId, vaultId: config.vaultId,
        vault: new ObsidianMarkdownVault(this.app), store, kv, blob: this.blob,
        inlineLimit: config.inlineLimit, status: this.status, logger: this.logger });
      this.engine = engine;
      const reconcileStartedAt = performance.now();
      this.initialReconcileInFlight = true;
      try {
        await engine.start();
      } finally {
        this.initialReconcileInFlight = false;
      }
      this.lastReconciledAt = Date.now();
      this.logger.debug("plugin.connect.first_reconcile_complete", {
        durationMs: Math.round(performance.now() - reconcileStartedAt), totalDurationMs: Math.round(performance.now() - startedAt),
      });
      if (!config.boundVaultId) {
        config.boundVaultId = config.vaultId;
        await this.saveSettings();
      }
      this.logger.debug("plugin.connected", { vaultId: config.vaultId });
      return { kind: "applied" };
    } catch (error) {
      await this.disconnect();
      const message = this.safeDiagnostic(error);
      const authenticationFailure = /auth|permission|password missing/i.test(String(error));
      this.status.lastError = message;
      this.status.connectionError = message;
      this.status.connectionState = authenticationFailure ? "AUTH_ERROR" : "OFFLINE";
      if (authenticationFailure) this.status.value = "AUTH_ERROR";
      this.status.refresh();
      this.logger.error("plugin.connect_failed", error, { vaultId: config.vaultId, bucket: `OBS_${config.vaultId}_FILES`,
        durationMs: Math.round(performance.now() - startedAt) });
      return { kind: "connection-error", message };
    }
  }

  async getConflicts(): Promise<ConflictRecord[]> {
    return this.store ? this.store.unresolvedConflicts() : [];
  }

  async getConflictHistory(): Promise<ConflictHistoryEntry[]> {
    return this.store ? this.store.conflictHistory() : [];
  }

  async compareConflict(operationId: string): Promise<ConflictComparison> {
    if (!this.engine) throw new Error("Conflict review is unavailable until sync starts");
    return this.engine.compareConflict(operationId);
  }

  async createConflictReview(operationId: string): Promise<string> {
    const conflict = (await this.getConflicts()).find((item) => item.operationId === operationId);
    if (!conflict) throw new Error("Conflict is no longer available for review");
    const comparison = await this.compareConflict(operationId);
    const timestamp = new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
    const name = (conflict.originalPath.split("/").at(-1)?.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 80)) || "conflict";
    const path = `${CONFLICT_REVIEW_FOLDER}/${name}-${timestamp}-${crypto.randomUUID()}.md`;
    if (!this.app.vault.getAbstractFileByPath(CONFLICT_REVIEW_FOLDER)) await this.app.vault.createFolder(CONFLICT_REVIEW_FOLDER);
    await this.app.vault.create(path, formatConflictReviewNote({
      originalPath: conflict.originalPath, copyPath: conflict.copyPath, remoteRevision: conflict.remoteRevision,
      detectionRemoteHash: conflict.detectionRemoteHash, detectionCopyHash: conflict.detectionCopyHash, comparison,
    }));
    await this.app.workspace.openLinkText(path, "", false);
    return path;
  }

  async keepRemote(operationId: string): Promise<void> {
    if (!this.engine) throw new Error("Conflict resolution is unavailable until sync starts");
    await this.engine.keepRemote(operationId);
  }

  async keepLocalCopy(operationId: string): Promise<void> {
    if (!this.engine) throw new Error("Conflict resolution is unavailable until sync starts");
    await this.engine.keepLocalCopy(operationId);
  }

  async markConflictResolved(operationId: string): Promise<void> {
    if (!this.engine) throw new Error("Conflict resolution is unavailable until sync starts");
    await this.engine.markResolved(operationId);
  }
}

