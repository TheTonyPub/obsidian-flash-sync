import { Setting, ToggleComponent } from "obsidian";
import type { SettingsField, SettingsValidationErrors } from "../settings-validation.js";
import { button, groupHeading, icon, statusPill, withDisabled, type SectionContext } from "./dom.js";
import { serverChanges, type SettingsApplyResult, type SettingsDraft, type ServerChangeKey } from "./model.js";
import { attachmentFact, serverFact } from "./status-facts.js";

/** Server edits one staged draft that the tab owns across renders. */
export interface ServerContext extends SectionContext {
  draft(): SettingsDraft;
  discardDraft(): void;
  saveDraft(): Promise<SettingsApplyResult>;
}

type SecretKind = "password" | "s3Secret";
type TextOptions = { disabled?: boolean; placeholder?: string };

export class ServerSection {
  private readonly fieldRows = new Map<SettingsField, { input: HTMLInputElement; row: Setting; help: string }>();
  private markers: Array<{ element: HTMLElement; keys: ServerChangeKey[] }> = [];
  private replacing: Record<SecretKind, boolean> = { password: false, s3Secret: false };
  private connectionStatusEl?: HTMLElement;
  private attachmentStatusEl?: HTMLElement;
  private attachmentFieldsEl?: HTMLElement;
  private saveBar?: HTMLElement;
  private saveCount?: HTMLElement;
  private saveFields?: HTMLElement;
  private pendingFocus?: SettingsField;

  constructor(private readonly ctx: ServerContext) {}

  /** Forget per-edit state after the draft is saved or discarded. */
  reset(): void {
    this.replacing = { password: false, s3Secret: false };
  }

  render(panel: HTMLElement, focus?: "password"): void {
    this.fieldRows.clear();
    this.markers = [];
    const draft = this.ctx.draft();
    const { config } = this.ctx.host;
    if (focus === "password") { this.replacing.password = true; this.pendingFocus = "hasPassword"; }

    const banner = panel.createDiv({ cls: "flash-sync-banner" });
    icon(banner, "clipboard-paste");
    banner.createSpan({ text: "Another device already syncs this vault? Paste its transfer code instead of typing every field." });
    button(banner, "Paste transfer code", { onClick: () => this.ctx.openImport() });

    const serverHead = groupHeading(panel, "Sync server", "server");
    this.connectionStatusEl = serverHead.createDiv({ cls: "flash-sync-group-status" });
    const serverCard = panel.createDiv({ cls: "flash-sync-card" });
    const bound = Boolean(config.boundVaultId);
    const vaultRow = this.textRow(serverCard, "vaultId", ["vaultId"], "Vault ID", bound
      ? "Locked after the first connection so this vault can't join the wrong bucket."
      : "Use the same vault ID on every device that joins this vault.", draft.vaultId,
    (value) => { draft.vaultId = value.trim(); }, { disabled: bound });
    if (bound) icon(vaultRow.controlEl, "lock", "flash-sync-icon flash-sync-lock");
    this.textRow(serverCard, "server", ["server"], "Server address", "Secure WebSocket, starts with wss://", draft.server,
      (value) => { draft.server = value.trim(); }, { placeholder: "wss://sync.example.com" });
    this.textRow(serverCard, "username", ["username"], "Username", "The per-vault account from your server administrator.",
      draft.username, (value) => { draft.username = value.trim(); });
    this.secretRow(serverCard, "hasPassword", "password", "Password", "Kept in Obsidian's keychain, never in plugin settings.",
      draft.passwordSecretKey, draft.natsPassword, (value) => { draft.natsPassword = value; });

    const attachmentHead = panel.createDiv({ cls: "flash-sync-group-head flash-sync-attachments-head" });
    icon(attachmentHead, "image");
    attachmentHead.createEl("h3", { text: "Attachment storage" });
    attachmentHead.createSpan({ cls: "flash-sync-tag", text: "Optional" });
    this.marker(attachmentHead, ["attachments"]);
    this.attachmentStatusEl = attachmentHead.createDiv({ cls: "flash-sync-group-status" });
    const toggle = new ToggleComponent(attachmentHead).setValue(draft.attachmentsEnabled).onChange((enabled) => {
      draft.attachmentsEnabled = enabled;
      this.renderAttachmentFields();
      this.updateDirty();
      this.refresh();
    });
    toggle.toggleEl.setAttribute("aria-label", "Use attachment storage");
    panel.createEl("p", { cls: "flash-sync-group-desc", text: `Images and files larger than ${Math.round(config.inlineLimit / 1024)} KiB ` +
      "go through S3. Turned off, they stay on this device — notes still sync." });
    this.attachmentFieldsEl = panel.createDiv({ cls: "flash-sync-card" });
    this.renderAttachmentFields();

    this.saveBar = panel.createDiv({ cls: "flash-sync-save-bar", attr: { role: "region", "aria-label": "Unsaved changes" } });
    this.saveBar.createSpan({ cls: "flash-sync-dot", attr: { "aria-hidden": "true" } });
    const text = this.saveBar.createDiv({ cls: "flash-sync-save-text" });
    this.saveCount = text.createDiv({ cls: "flash-sync-save-count" });
    this.saveFields = text.createDiv({ cls: "flash-sync-save-fields" });
    const actions = this.saveBar.createDiv({ cls: "flash-sync-save-actions" });
    button(actions, "Discard", { onClick: () => this.ctx.discardDraft() });
    button(actions, "Save and reconnect", { cta: true, onClick: (target) => withDisabled(target, () => this.ctx.saveDraft()) });

    this.updateDirty();
    this.refresh();
    const pending = this.pendingFocus;
    this.pendingFocus = undefined;
    if (pending) this.fieldRows.get(pending)?.input.focus();
  }

  /** Status changes only touch status labels, so typed values and focus stay put. */
  refresh(): void {
    const { status, config } = this.ctx.host;
    if (this.connectionStatusEl) {
      this.connectionStatusEl.empty();
      statusPill(this.connectionStatusEl, serverFact(status, config));
    }
    if (this.attachmentStatusEl) {
      this.attachmentStatusEl.empty();
      if (this.ctx.draft().attachmentsEnabled) statusPill(this.attachmentStatusEl, attachmentFact(status, config));
    }
  }

  showErrors(errors: SettingsValidationErrors): void {
    for (const [field, message] of Object.entries(errors) as Array<[SettingsField, string]>) {
      const row = this.fieldRows.get(field);
      if (!row) continue;
      row.row.setDesc(message);
      row.row.descEl.classList.add("flash-sync-field-error");
    }
    const first = (Object.keys(errors) as SettingsField[]).find((field) => this.fieldRows.has(field));
    if (first) this.fieldRows.get(first)!.input.focus();
  }

  private renderAttachmentFields(): void {
    const region = this.attachmentFieldsEl;
    if (!region) return;
    const draft = this.ctx.draft();
    region.empty();
    for (const field of ["s3Endpoint", "s3Bucket", "s3Region", "s3AccessKeyId", "hasS3Secret"] as const) this.fieldRows.delete(field);
    this.markers = this.markers.filter((marker) => !marker.keys.some((key) => key.startsWith("s3")));
    region.hidden = !draft.attachmentsEnabled;
    if (!draft.attachmentsEnabled) return;
    this.textRow(region, "s3Endpoint", ["s3Endpoint"], "Endpoint", "", draft.s3Endpoint,
      (value) => { draft.s3Endpoint = value.trim(); }, { placeholder: "https://s3.example.com" });
    const bucketRow = new Setting(region).setName("Bucket and region");
    this.marker(bucketRow.nameEl, ["s3Bucket", "s3Region"]);
    this.addInput(bucketRow, "s3Bucket", "", draft.s3Bucket, (value) => { draft.s3Bucket = value.trim(); }, { placeholder: "Bucket" }, "Bucket");
    this.addInput(bucketRow, "s3Region", "", draft.s3Region, (value) => { draft.s3Region = value.trim(); }, { placeholder: "Region" }, "Region");
    bucketRow.settingEl.classList.add("flash-sync-pair");
    this.textRow(region, "s3AccessKeyId", ["s3AccessKeyId"], "Access key ID", "", draft.s3AccessKeyId,
      (value) => { draft.s3AccessKeyId = value.trim(); });
    this.secretRow(region, "hasS3Secret", "s3Secret", "Secret access key", "", draft.s3SecretKeySecretKey, draft.s3Secret,
      (value) => { draft.s3Secret = value; });
  }

  private marker(parent: HTMLElement, keys: ServerChangeKey[]): void {
    const element = parent.createSpan({ cls: "flash-sync-edited", text: "Edited" });
    element.hidden = true;
    this.markers.push({ element, keys });
  }

  private textRow(parent: HTMLElement, field: SettingsField, keys: ServerChangeKey[], name: string, help: string, value: string,
    update: (value: string) => void, options: TextOptions = {}): Setting {
    const row = new Setting(parent).setName(name);
    if (help) row.setDesc(help);
    this.marker(row.nameEl, keys);
    this.addInput(row, field, help, value, update, options);
    return row;
  }

  private addInput(row: Setting, field: SettingsField, help: string, value: string, update: (value: string) => void,
    options: TextOptions, label?: string): void {
    row.addText((text) => {
      text.setValue(value).setDisabled(Boolean(options.disabled));
      if (options.placeholder) text.setPlaceholder(options.placeholder);
      if (label) text.inputEl.setAttribute("aria-label", label);
      text.onChange((next) => { update(next); this.clearFieldError(field); this.updateDirty(); });
      this.fieldRows.set(field, { input: text.inputEl, row, help });
    });
  }

  /** A saved secret shows only its saved state; Replace swaps in an empty password field. */
  private secretRow(parent: HTMLElement, field: SettingsField, kind: SecretKind, name: string, help: string, secretKey: string,
    value: string, update: (value: string) => void): void {
    const row = new Setting(parent).setName(name);
    if (help) row.setDesc(help);
    this.marker(row.nameEl, [kind]);
    let saved = false;
    try { saved = Boolean(secretKey && this.ctx.app.secretStorage.getSecret(secretKey)); }
    catch { saved = false; }
    if (saved && !this.replacing[kind]) {
      const state = row.controlEl.createSpan({ cls: "flash-sync-saved" });
      icon(state, "check");
      state.createSpan({ text: "Saved in keychain" });
      row.addButton((replace) => replace.setButtonText("Replace…").onClick(() => {
        this.replacing[kind] = true;
        this.pendingFocus = field;
        this.ctx.rerender();
      }));
      return;
    }
    row.addText((text) => {
      text.inputEl.type = "password";
      text.inputEl.autocomplete = "new-password";
      text.setValue(value).setPlaceholder(saved ? "Enter a replacement" : "Required");
      text.onChange((next) => { update(next); this.clearFieldError(field); this.updateDirty(); });
      this.fieldRows.set(field, { input: text.inputEl, row, help });
    });
  }

  private clearFieldError(field: SettingsField): void {
    const row = this.fieldRows.get(field);
    if (!row) return;
    row.row.setDesc(row.help);
    row.row.descEl.classList.remove("flash-sync-field-error");
  }

  private updateDirty(): void {
    const changes = serverChanges(this.ctx.draft(), this.ctx.host.config);
    const keys = new Set(changes.map((change) => change.key));
    for (const marker of this.markers) marker.element.hidden = !marker.keys.some((key) => keys.has(key));
    if (!this.saveBar) return;
    this.saveBar.hidden = changes.length === 0;
    this.saveCount!.textContent = `${changes.length} unsaved ${changes.length === 1 ? "change" : "changes"}`;
    this.saveFields!.textContent = `${changes.map((change) => change.label).join(", ")} · saving reconnects sync`;
  }
}
