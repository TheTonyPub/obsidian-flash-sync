import { App, Modal, Notice, Setting } from "obsidian";
import QRCode from "qrcode";
import { decryptTransfer, generateTransferPhrase, transferVersion, type TransferConfig } from "../config-transfer.js";
import { PLUGIN_ID } from "../plugin-identity.js";
import { validateSettingsDraft } from "../settings-validation.js";
import { button, copyText, icon } from "./dom.js";
import type { SettingsApplyResult, SettingsHost } from "./model.js";

type ShareNavigator = Navigator & { share?: (data: { title?: string; text?: string; url?: string }) => Promise<void> };

/**
 * Send settings: a generated, replaceable phrase protects the code by default. The phrase never
 * enters the code or link; an unprotected code needs an explicit, warned opt-out.
 */
export class ExportConfigModal extends Modal {
  private phrase = generateTransferPhrase();
  private unprotected = false;
  private generation = 0;
  private uri = "";
  private payload = "";
  private phraseInput!: HTMLInputElement;
  private qrEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private includesEl!: HTMLElement;
  private readonly readyButtons: HTMLButtonElement[] = [];

  constructor(app: App, private readonly plugin: SettingsHost, private readonly mobile: boolean) { super(app); }

  onOpen(): void {
    const { contentEl } = this;
    this.modalEl.classList.add("flash-sync-transfer-modal");
    contentEl.empty();
    contentEl.createEl("h2", { text: "Send settings to a new device" });
    contentEl.createEl("p", { cls: "flash-sync-muted",
      text: "The new device needs two things: the code below and the phrase. Share them separately." });

    const phraseStep = this.step(contentEl, "1", "Code phrase");
    const phraseRow = phraseStep.createDiv({ cls: "flash-sync-phrase-row" });
    this.phraseInput = phraseRow.createEl("input", { cls: "flash-sync-phrase-input", attr: { type: "text", "aria-label": "Code phrase",
      autocomplete: "off", spellcheck: "false" } });
    this.phraseInput.value = this.phrase;
    this.phraseInput.addEventListener("change", () => { this.phrase = this.phraseInput.value.trim(); void this.generate(); });
    button(phraseRow, "New phrase", { icon: "refresh-cw", onClick: () => {
      this.phrase = generateTransferPhrase();
      this.phraseInput.value = this.phrase;
      void this.generate();
    } });
    phraseStep.createEl("p", { cls: "flash-sync-muted",
      text: "Generated for you — or type your own, 8+ characters. It is never stored in the code or link." });

    const shareStep = this.step(contentEl, "2", "Scan or send the link");
    const share = shareStep.createDiv({ cls: "flash-sync-share" });
    this.qrEl = share.createDiv({ cls: "flash-sync-qr" });
    const side = share.createDiv({ cls: "flash-sync-share-side" });
    const phone = side.createEl("p");
    phone.createEl("strong", { text: "Phone: " });
    phone.createSpan({ text: "scan with the Camera app. Obsidian opens and asks for the phrase." });
    const computer = side.createEl("p");
    computer.createEl("strong", { text: "Computer: " });
    computer.createSpan({ text: `copy the link and open it there, or paste the code in ${PLUGIN_ID}.` });
    const actions = side.createDiv({ cls: "flash-sync-modal-actions is-start" });
    this.readyButtons.push(button(actions, "Copy link", { cta: true, icon: "copy", onClick: async () => {
      await copyText(this.uri);
      new Notice("Transfer link copied");
    } }));
    this.readyButtons.push(button(actions, "Copy code only", { onClick: async () => {
      await copyText(this.payload);
      new Notice("Transfer code copied");
    } }));
    const nav = navigator as ShareNavigator;
    if (this.mobile && typeof nav.share === "function") {
      this.readyButtons.push(button(actions, "Share…", { icon: "share", onClick: async () => {
        try { await nav.share!({ title: `${PLUGIN_ID} settings`, text: "Open this link on the new device, then enter the code phrase.", url: this.uri }); }
        catch (error) { if (!(error instanceof Error && error.name === "AbortError")) new Notice(this.plugin.safeDiagnostic(error)); }
      } }));
    }
    this.includesEl = side.createDiv({ cls: "flash-sync-includes" });
    this.statusEl = contentEl.createDiv({ cls: "flash-sync-transfer-status", attr: { role: "status", "aria-live": "polite" } });

    const footer = contentEl.createDiv({ cls: "flash-sync-modal-footer" });
    const optOut = contentEl.createDiv({ cls: "flash-sync-unprotected" });
    button(footer, "Create without a phrase…", { cls: "flash-sync-link", onClick: (target) => {
      target.hidden = true;
      this.renderOptOut(optOut);
    } });
    button(footer, "Done", { onClick: () => this.close() });
    void this.generate();
  }

  onClose(): void {
    this.generation++;
    this.contentEl.empty();
  }

  private step(parent: HTMLElement, number: string, title: string): HTMLElement {
    const step = parent.createDiv({ cls: "flash-sync-step" });
    const heading = step.createDiv({ cls: "flash-sync-step-head" });
    heading.createSpan({ cls: "flash-sync-step-number", text: number, attr: { "aria-hidden": "true" } });
    heading.createEl("h3", { text: title });
    return step;
  }

  private renderOptOut(region: HTMLElement): void {
    region.empty();
    region.createEl("p", { cls: "flash-sync-warning",
      text: "Anyone who sees the QR code or link can read the password and keys. Use this only when you cannot share a phrase." });
    const label = region.createEl("label", { cls: "flash-sync-checkbox" });
    const checkbox = label.createEl("input", { attr: { type: "checkbox" } });
    label.createSpan({ text: " Create an unprotected code" });
    checkbox.addEventListener("change", () => {
      this.unprotected = checkbox.checked;
      this.phraseInput.disabled = checkbox.checked;
      void this.generate();
    });
  }

  private renderIncludes(): void {
    const { config } = this.plugin;
    this.includesEl.empty();
    this.includesEl.createDiv({ cls: "flash-sync-muted", text: "Includes" });
    const list = this.includesEl.createEl("ul");
    const item = (text: string): void => { const entry = list.createEl("li"); icon(entry, "check"); entry.createSpan({ text }); };
    item(`Vault ${config.vaultId}, server address and username`);
    item(this.unprotected ? "Password, readable by anyone with the code" : "Password, encrypted with the phrase");
    if (config.s3Endpoint) item("Attachment storage (S3) and its keys");
  }

  private setReady(ready: boolean): void {
    for (const target of this.readyButtons) target.disabled = !ready;
  }

  private async generate(): Promise<void> {
    const generation = ++this.generation;
    this.uri = this.payload = "";
    this.setReady(false);
    this.qrEl.empty();
    this.statusEl.empty();
    this.statusEl.classList.remove("flash-sync-warning");
    this.renderIncludes();
    if (!this.unprotected && this.phrase.length < 8) {
      this.statusEl.createSpan({ text: "Enter a code phrase with at least eight characters." });
      return;
    }
    try {
      const payload = await this.plugin.exportConfig(this.unprotected ? "" : this.phrase);
      const uri = `obsidian://${PLUGIN_ID}-import?data=${encodeURIComponent(payload)}`;
      const image = await QRCode.toDataURL(uri, { errorCorrectionLevel: "M", margin: 2, width: 400 });
      if (generation !== this.generation) return;
      this.payload = payload;
      this.uri = uri;
      this.qrEl.createEl("img", { attr: { src: image, alt: `${PLUGIN_ID} settings QR code` } });
      this.setReady(true);
      if (this.unprotected) {
        this.statusEl.classList.add("flash-sync-warning");
        this.statusEl.createSpan({ text: "Unprotected — contains readable credentials." });
      }
    } catch (error) {
      if (generation !== this.generation) return;
      this.statusEl.createSpan({ text: this.plugin.safeDiagnostic(error) });
    }
  }
}

export class ImportConfigModal extends Modal {
  constructor(app: App, private readonly plugin: SettingsHost, private readonly initialPayload: string) { super(app); }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: `Import ${PLUGIN_ID} settings` });
    let payload = this.initialPayload;
    let phrase = "";
    let decoded: TransferConfig | undefined;
    const result = contentEl.createDiv();
    const preview = contentEl.createDiv({ cls: "flash-sync-transfer-preview" });
    const transferSetting = new Setting(contentEl);
    const phraseSetting = new Setting(contentEl);
    const updatePhraseRequirement = (): void => {
      try {
        phraseSetting.settingEl.toggle(transferVersion(payload) === 1);
      } catch { phraseSetting.settingEl.toggle(false); }
      decoded = undefined;
      preview.empty();
      result.empty();
    };
    transferSetting.setName("Transfer code")
      .setDesc("Paste a transfer code, or open a transfer link from another device.")
      .addTextArea((input) => input.setValue(payload).onChange((value) => { payload = value.trim(); updatePhraseRequirement(); }));
    phraseSetting.setName("Code phrase")
      .setDesc("Required for protected transfer codes.")
      .addText((input) => { input.inputEl.type = "password"; input.inputEl.autocomplete = "current-password";
        input.onChange((value) => { phrase = value; decoded = undefined; }); });
    updatePhraseRequirement();
    new Setting(contentEl).addButton((button) => {
      button.setButtonText("Preview settings").onClick(async () => {
        result.empty(); preview.empty(); button.setDisabled(true);
        try {
          decoded = await decryptTransfer(payload, phrase);
          const validation = validateSettingsDraft({ vaultId: decoded.vaultId, server: decoded.server,
            username: decoded.username, hasPassword: Boolean(decoded.natsPassword),
            attachmentsEnabled: Boolean(decoded.s3Endpoint || decoded.s3Bucket || decoded.s3AccessKeyId || decoded.s3SecretKey),
            s3Endpoint: decoded.s3Endpoint,
            s3Bucket: decoded.s3Bucket, s3Region: decoded.s3Region, s3AccessKeyId: decoded.s3AccessKeyId,
            hasS3Secret: Boolean(decoded.s3SecretKey), inlineLimitKiB: decoded.inlineLimit / 1024 });
          if (Object.keys(validation.errors).length) throw new Error(Object.values(validation.errors)[0]);
          preview.createEl("h3", { text: "Settings preview" });
          preview.createEl("p", { text: `Vault: ${decoded.vaultId}` });
          preview.createEl("p", { text: `Server: ${decoded.server}` });
          preview.createEl("p", { text: decoded.s3Endpoint ? `Attachments: ${decoded.s3Bucket} (${decoded.s3Endpoint})` : "Attachments: not configured; files stay local." });
          preview.createEl("p", { text: "Passwords and access keys are hidden." });
          if (this.plugin.config.boundVaultId && this.plugin.config.boundVaultId !== decoded.vaultId) {
            result.createEl("p", { text: "This device is bound to a different vault. Import is blocked." });
            decoded = undefined;
          } else {
            new Setting(preview).addButton((apply) => apply.setButtonText("Import and connect").onClick(async () => {
              if (!decoded) return;
              apply.setDisabled(true);
              try {
                let outcome: SettingsApplyResult;
                try { outcome = await this.plugin.importConfig(decoded); }
                catch (error) { result.createEl("p", { text: `Unable to import: ${this.plugin.safeDiagnostic(error)}` }); return; }
                if (outcome.kind === "applied") {
                  new Notice(`${PLUGIN_ID} settings saved and connected`);
                  this.close();
                } else if (outcome.kind === "connection-error") {
                  result.createEl("p", { text: "Settings saved. Connection failed." });
                  result.createEl("p", { text: outcome.message });
                  new Setting(result).addButton((retry) => retry.setButtonText("Retry connection").onClick(async () => {
                    retry.setDisabled(true);
                    try {
                      const retried = await this.plugin.connectNow();
                      if (retried.kind === "applied") this.close();
                      else result.createEl("p", { text: retried.kind === "connection-error"
                        ? `Connection is still unavailable. Settings remain saved. ${retried.message}`
                        : "Connection is still unavailable. Settings remain saved." });
                    } catch (error) {
                      result.createEl("p", { text: `Retry failed. Settings remain saved. ${this.plugin.safeDiagnostic(error)}` });
                    } finally { retry.setDisabled(false); }
                  }));
                } else {
                  result.createEl("p", { text: outcome.kind === "validation-error" ? Object.values(outcome.errors)[0] ?? "Invalid settings." :
                    outcome.kind === "persistence-error" ? `Could not save settings: ${outcome.message}` : "Settings were not connected." });
                }
              } finally { apply.setDisabled(false); }
            }));
          }
        } catch (error) { result.createEl("p", { text: `Unable to preview: ${this.plugin.safeDiagnostic(error)}` }); }
        finally { button.setDisabled(false); }
      });
    });
  }
}
