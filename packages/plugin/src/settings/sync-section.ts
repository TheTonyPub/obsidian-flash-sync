import { App, Modal, Notice, Platform } from "obsidian";
import type { ConflictHistoryEntry, ConflictRecord } from "../local-store.js";
import { overviewStatusPresentation, statusPresentation } from "../status-presentation.js";
import { button, copyText, groupHeading, icon, statusPill, withDisabled, type SectionContext } from "./dom.js";
import { connectionConfigured, type EasySyncSettings } from "./model.js";
import { attachmentFact, attachmentFailed, authFailed, formatAge, queueFact, serverFact } from "./status-facts.js";

const SERVER_GUIDE_URL = "https://github.com/TheTonyPub/obsidian-flash-sync/blob/master/docs/fos-usage.md";

type StatusBarMode = EasySyncSettings["statusBarMode"];

export function needsDecision(conflict: ConflictRecord): boolean {
  return conflict.lifecycle !== "pending-sync";
}

class ConfirmConflictActionModal extends Modal {
  constructor(app: App, private readonly action: string, private readonly consequence: string,
    private readonly onConfirm: () => Promise<void>) { super(app); }

  onOpen(): void {
    this.contentEl.empty();
    this.contentEl.createEl("h2", { text: this.action });
    this.contentEl.createEl("p", { text: this.consequence });
    this.contentEl.createEl("p", { text: "This applies only to the selected conflict after live versions are checked again.",
      cls: "flash-sync-muted" });
    const result = this.contentEl.createDiv({ attr: { role: "alert" } });
    const actions = this.contentEl.createDiv({ cls: "flash-sync-modal-actions" });
    button(actions, "Cancel", { onClick: () => this.close() });
    button(actions, "Confirm", { cta: true, onClick: (target) => withDisabled(target, async () => {
      try { await this.onConfirm(); this.close(); }
      catch (error) { result.empty(); result.createEl("p", { text: error instanceof Error ? error.message : String(error) }); }
    }) });
  }
}

/** Mobile bottom sheet with the same choices a desktop conflict card shows inline. */
class ConflictSheetModal extends Modal {
  constructor(app: App, private readonly conflict: ConflictRecord,
    private readonly renderActions: (parent: HTMLElement, done: () => void) => void) { super(app); }

  onOpen(): void {
    this.modalEl.classList.add("flash-sync-sheet");
    this.contentEl.empty();
    this.contentEl.createEl("h2", { text: basename(this.conflict.originalPath) });
    this.contentEl.createEl("p", { text: "Edited on this device and on another device. Which version should the note keep?",
      cls: "flash-sync-muted" });
    this.renderActions(this.contentEl, () => this.close());
  }
}

function basename(path: string): string {
  return path.split("/").at(-1) || path;
}

function folder(path: string): string {
  const parts = path.split("/");
  return parts.length > 1 ? parts.slice(0, -1).join("/") : "Vault root";
}

function conflictOrigin(conflict: ConflictRecord): string {
  if (conflict.lifecycle === "pending-sync") return "Your choice is uploading";
  if (conflict.context === "path-collision") return "created on two devices with the same name";
  if (conflict.context === "bootstrap") return "found while connecting this device";
  return "edited here and on another device";
}

export class SyncSection {
  private summaryEl?: HTMLElement;
  private conflictsEl?: HTMLElement;
  private transferEl?: HTMLElement;
  private previewEl?: HTMLElement;
  private conflicts?: ConflictRecord[];
  private history?: ConflictHistoryEntry[];
  private historyOpen = false;
  private readonly expanded = new Set<string>();
  private readonly collapsed = new Set<string>();
  private previewMode?: StatusBarMode;

  constructor(private readonly ctx: SectionContext) {}

  render(panel: HTMLElement): void {
    this.conflictsEl = this.transferEl = this.previewEl = undefined;
    this.summaryEl = panel.createDiv({ cls: "flash-sync-summary" });
    this.renderSummary();
    if (!connectionConfigured(this.ctx.host.config)) {
      this.renderSetup(panel);
      return;
    }
    this.conflictsEl = panel.createDiv({ cls: "flash-sync-conflicts" });
    this.renderConflicts();
    this.transferEl = panel.createDiv({ cls: "flash-sync-transfer" });
    this.renderTransfer();
    this.renderAppearance(panel.createDiv({ cls: "flash-sync-appearance" }));
  }

  refresh(): void {
    this.renderSummary();
    this.renderTransfer();
    this.renderPreview();
  }

  setConflicts(conflicts: ConflictRecord[]): void {
    this.conflicts = conflicts;
    this.renderSummary();
    this.renderConflicts();
    this.renderTransfer();
  }

  private decisionCount(): number {
    const { status } = this.ctx.host;
    return this.conflicts ? this.conflicts.filter(needsDecision).length : Math.max(status.conflicts, status.conflictPaths.length);
  }

  private summaryCopy(): { title: string; sentence: string } {
    const { status, config } = this.ctx.host;
    const presentation = statusPresentation(status);
    if (!connectionConfigured(config)) {
      return { title: "This vault isn't syncing yet", sentence: "Connect it once — every later change syncs on its own." };
    }
    if (authFailed(status)) {
      return { title: "Can't sign in to the sync server", sentence: `The server rejected ${config.username || "this account"}. ` +
        "Your edits are safe on this device and upload as soon as you reconnect." };
    }
    if (!status.connected) {
      const sentence = status.retrying ? "The server can't be reached right now. Local edits stay queued on this device and upload when it is back."
        : status.connectionState === "CONNECTING" ? "Opening a connection to your server. Local edits stay queued until it is ready."
          : "Local edits stay queued on this device and upload when the server is reachable.";
      return { title: presentation.label, sentence };
    }
    const checked = status.lastReconciledAt ? ` · checked ${formatAge(status.lastReconciledAt)}` : "";
    if (presentation.icon === "file-diff") {
      const count = this.decisionCount() || Math.max(status.conflicts, status.conflictPaths.length);
      return { title: `${count} ${count === 1 ? "note needs" : "notes need"} your decision`,
        sentence: "Everything else keeps syncing. Both versions of each note are kept until you choose." };
    }
    if (presentation.color === "error") {
      return { title: presentation.label, sentence: "Some changes could not sync. They stay on this device and are retried." };
    }
    if (presentation.color === "success") return { title: presentation.label, sentence: `Everything on this device matches the server${checked}` };
    return { title: presentation.label, sentence: `Uploading and checking changes${checked}` };
  }

  private renderSummary(): void {
    const card = this.summaryEl;
    if (!card) return;
    const { host } = this.ctx;
    const { status, config } = host;
    const aggregate = overviewStatusPresentation(status);
    const configured = connectionConfigured(config);
    const auth = configured && authFailed(status);
    card.empty();
    card.classList.remove("flash-sync-tone-green", "flash-sync-tone-yellow", "flash-sync-tone-red", "flash-sync-tone-gray");
    card.classList.add(`flash-sync-tone-${aggregate.color}`);

    const head = card.createDiv({ cls: "flash-sync-summary-head" });
    icon(head.createDiv({ cls: "flash-sync-summary-icon" }), configured ? statusPresentation(status).icon : "cloud-off");
    const copy = this.summaryCopy();
    const text = head.createDiv({ cls: "flash-sync-summary-text" });
    const label = text.createDiv({ cls: "flash-sync-summary-label",
      attr: { role: "status", "aria-live": "polite", "aria-label": `Sync status: ${aggregate.label}` } });
    label.createDiv({ cls: "flash-sync-summary-title", text: copy.title });
    label.createDiv({ cls: "flash-sync-summary-sentence", text: copy.sentence });
    if (!configured) return;

    if (auth) {
      const actions = text.createDiv({ cls: "flash-sync-summary-actions" });
      button(actions, "Update password", { cta: true, onClick: () => this.ctx.openSection("server", "password") });
      button(actions, "Try again", { onClick: (target) => withDisabled(target, () => host.connectNow()) });
      button(actions, "Paste transfer code", { cls: "flash-sync-link", onClick: () => this.ctx.openImport() });
    } else {
      const sync = button(head.createDiv({ cls: "flash-sync-summary-side" }), "Sync now", { icon: "refresh-cw",
        onClick: (target) => withDisabled(target, () => host.syncNow()) });
      sync.disabled = status.connectionState === "CONNECTING";
    }

    const facts = card.createDiv({ cls: "flash-sync-facts" });
    const fact = (title: string, value: { tone: "green" | "yellow" | "red" | "gray"; value: string; detail: string }, dot = true) => {
      const item = facts.createDiv({ cls: "flash-sync-fact" });
      item.createDiv({ cls: "flash-sync-fact-label", text: title });
      if (dot) statusPill(item, value, "flash-sync-fact-value");
      else item.createDiv({ cls: "flash-sync-fact-value", text: value.value });
      item.createDiv({ cls: "flash-sync-fact-detail", text: value.detail });
      return item;
    };
    fact("Sync server", serverFact(status, config));
    const attachments = fact("Attachments", attachmentFact(status, config));
    if (attachmentFailed(status)) {
      button(attachments, "Check attachment settings", { cls: "flash-sync-link", onClick: () => this.ctx.openSection("server") });
    }
    fact("Waiting to upload", queueFact(status), false);

    const message = status.connectionError || status.attachmentError || status.lastError;
    if (message) {
      const details = card.createEl("details", { cls: "flash-sync-details" });
      const summary = details.createEl("summary");
      summary.createSpan({ text: "Technical details" });
      const safe = host.safeDiagnostic(message);
      summary.createEl("code", { text: safe });
      button(details, "Copy", { cls: "flash-sync-link", label: "Copy technical details", onClick: async () => {
        await copyText(safe);
        new Notice("Technical details copied");
      } });
    }
  }

  private renderSetup(panel: HTMLElement): void {
    panel.createEl("h3", { text: "How do you want to connect?", cls: "flash-sync-section-title" });
    const choices = panel.createDiv({ cls: "flash-sync-choices" });
    const choice = (iconName: string, title: string, description: string, primary: boolean) => {
      const card = choices.createDiv({ cls: primary ? "flash-sync-choice-card is-primary" : "flash-sync-choice-card" });
      icon(card.createDiv({ cls: "flash-sync-choice-icon" }), iconName);
      const heading = card.createDiv({ cls: "flash-sync-choice-title" });
      heading.createSpan({ text: title });
      if (primary) heading.createSpan({ cls: "flash-sync-tag is-accent", text: "Fastest" });
      card.createEl("p", { text: description });
      return card;
    };
    button(choice("smartphone", "From another device", "On a device that already syncs, open flash-sync › Send settings to a new device. " +
      "Then paste the code here or scan its QR.", true), "Paste transfer code", { cta: true, onClick: () => this.ctx.openImport() });
    button(choice("server", "Enter server details", "For the first device. You need the server address, vault ID, username and " +
      "password from your administrator.", false), "Set up manually", { onClick: () => this.ctx.openSection("server") });
    const hint = panel.createEl("p", { cls: "flash-sync-hint" });
    icon(hint, "info");
    hint.createSpan({ text: "Running your own server? The " });
    hint.createEl("code", { text: "fos" });
    hint.createSpan({ text: " CLI creates vault accounts and can print a transfer code directly. " });
    hint.createEl("a", { text: "Server guide", attr: { href: SERVER_GUIDE_URL } });
  }

  private renderConflicts(): void {
    const region = this.conflictsEl;
    if (!region) return;
    region.empty();
    const conflicts = this.conflicts ?? [];
    const head = region.createDiv({ cls: "flash-sync-group-head" });
    head.createEl("h3", { text: conflicts.length ? `Conflicts · ${conflicts.length}` : "Conflicts" });
    const history = button(head, "History", { icon: "history", cls: "flash-sync-link flash-sync-push",
      onClick: () => this.toggleHistory() });
    history.setAttribute("aria-expanded", String(this.historyOpen));

    if (this.conflicts && !conflicts.length) {
      const empty = region.createDiv({ cls: "flash-sync-empty" });
      icon(empty, "check");
      empty.createSpan({ cls: "flash-sync-empty-title", text: "No conflicts" });
      if (!this.ctx.mobile) {
        empty.createSpan({ cls: "flash-sync-empty-desc", text: "When two devices edit the same note, both versions are kept and you choose here." });
      }
    }
    const list = region.createDiv({ cls: "flash-sync-conflict-list" });
    const firstDecision = conflicts.find(needsDecision)?.operationId;
    for (const conflict of conflicts) this.renderConflict(list, conflict, conflict.operationId === firstDecision);

    if (this.historyOpen) {
      const historyEl = region.createDiv({ cls: "flash-sync-history" });
      historyEl.createEl("h4", { text: "Conflict history" });
      if (!this.history) historyEl.createEl("p", { text: "Loading…", cls: "flash-sync-muted" });
      else if (!this.history.length) historyEl.createEl("p", { text: "No conflict history yet.", cls: "flash-sync-muted" });
      for (const event of this.history ?? []) {
        historyEl.createEl("p", { text: `${event.event ?? "event"}: ${event.outcome ?? event.context ?? "recorded"}` });
      }
    }
  }

  private async toggleHistory(): Promise<void> {
    this.historyOpen = !this.historyOpen;
    this.history = undefined;
    this.renderConflicts();
    if (!this.historyOpen) return;
    try { this.history = await this.ctx.host.getConflictHistory(); }
    catch { this.history = []; }
    this.renderConflicts();
  }

  private renderConflict(list: HTMLElement, conflict: ConflictRecord, defaultOpen: boolean): void {
    const id = conflict.operationId;
    const pending = !needsDecision(conflict);
    const mobile = this.ctx.mobile;
    const expanded = !mobile && (this.expanded.has(id) || (defaultOpen && !this.collapsed.has(id)));
    const item = list.createDiv({ cls: expanded ? "flash-sync-conflict is-expanded" : "flash-sync-conflict" });
    const bodyId = `flash-sync-conflict-${id.replace(/[^A-Za-z0-9_-]/g, "-")}`;
    const head = item.createEl("button", { cls: "flash-sync-conflict-head", attr: { type: "button" } });
    if (mobile) head.setAttribute("aria-haspopup", "dialog");
    else { head.setAttribute("aria-expanded", String(expanded)); head.setAttribute("aria-controls", bodyId); }
    icon(head, conflict.kind === "blob" ? "file-image" : "file-text");
    const title = head.createDiv({ cls: "flash-sync-conflict-title" });
    title.createDiv({ cls: "flash-sync-conflict-name", text: basename(conflict.originalPath) });
    title.createDiv({ cls: "flash-sync-conflict-meta", text: pending ? conflictOrigin(conflict)
      : `${folder(conflict.originalPath)} · ${conflictOrigin(conflict)}` });
    head.createSpan({ cls: pending ? "flash-sync-badge is-muted" : "flash-sync-badge is-warning",
      text: pending ? "Waiting for sync" : "Needs decision" });
    icon(head, mobile ? "chevron-right" : expanded ? "chevron-up" : "chevron-down");
    head.addEventListener("click", () => {
      if (mobile) {
        if (!pending) new ConflictSheetModal(this.ctx.app, conflict, (parent, done) => this.renderActions(parent, conflict, done)).open();
        return;
      }
      if (expanded) { this.expanded.delete(id); this.collapsed.add(id); }
      else { this.expanded.add(id); this.collapsed.delete(id); }
      this.renderConflicts();
    });

    const body = item.createDiv({ cls: "flash-sync-conflict-body", attr: { id: bodyId } });
    body.hidden = !expanded;
    if (!expanded) return;
    if (pending) {
      body.createEl("p", { text: "Waiting for sync. Your choice uploads when the server is reachable; nothing else to do here.",
        cls: "flash-sync-muted" });
      return;
    }
    this.renderActions(body, conflict);
  }

  /** Both choices with their consequence, an emphasized comparison, then secondary escapes. */
  private renderActions(parent: HTMLElement, conflict: ConflictRecord, done: () => void = () => {}): void {
    const { host, app } = this.ctx;
    const id = conflict.operationId;
    const confirm = (action: string, consequence: string, operation: () => Promise<void>) => {
      done();
      new ConfirmConflictActionModal(app, action, consequence, async () => {
        await operation();
        await this.ctx.reloadConflicts();
      }).open();
    };
    const grid = parent.createDiv({ cls: "flash-sync-choice-grid" });
    const choice = (title: string, meta: string, description: string, label: string, run: () => void) => {
      const card = grid.createDiv({ cls: "flash-sync-choice" });
      const heading = card.createDiv({ cls: "flash-sync-choice-head" });
      heading.createEl("strong", { text: title });
      heading.createSpan({ cls: "flash-sync-muted", text: meta });
      card.createEl("p", { text: description });
      button(card, label, { onClick: run });
    };
    const serverConsequence = "Replaces the note on this device. Your text stays in the conflict copy.";
    const deviceConsequence = "Puts your text back into the note and uploads it over the server version.";
    choice("Server version", `rev ${conflict.remoteRevision}`, serverConsequence, "Keep server version",
      () => confirm("Keep server version", serverConsequence, () => host.keepRemote(id)));
    choice("This device's version", "conflict copy", deviceConsequence, "Keep my version",
      () => confirm("Keep my version", deviceConsequence, () => host.keepLocalCopy(id)));
    parent.createEl("p", { cls: "flash-sync-conflict-path", text: `Conflict copy: ${conflict.copyPath}` });

    const footer = parent.createDiv({ cls: "flash-sync-conflict-footer" });
    button(footer, "Compare side by side", { cta: true, icon: "columns-2", onClick: async () => {
      done();
      try { await host.createConflictReview(id); }
      catch (error) { new Notice(`Unable to create conflict review: ${host.safeDiagnostic(error)}`); }
    } });
    button(footer, "Open conflict copy", { cls: "flash-sync-link", onClick: async () => {
      done();
      await app.workspace.openLinkText(conflict.copyPath, "", false);
    } });
    const manual = footer.createDiv({ cls: "flash-sync-manual" });
    manual.createSpan({ cls: "flash-sync-muted", text: "Merged by hand?" });
    button(manual, "Mark resolved", { cls: "flash-sync-quiet", onClick: () => confirm("Mark resolved",
      "Use this after you merged or deleted the copies yourself. Your notes are not changed.", () => host.markConflictResolved(id)) });
  }

  private renderTransfer(): void {
    const region = this.transferEl;
    if (!region) return;
    region.empty();
    const auth = authFailed(this.ctx.host.status);
    groupHeading(region, "Other devices");
    const card = region.createDiv({ cls: "flash-sync-card" });
    const row = (cls: string, iconName: string, name: string, description: string) => {
      const element = card.createDiv({ cls: `flash-sync-row ${cls}` });
      icon(element.createDiv({ cls: "flash-sync-row-icon" }), iconName);
      const info = element.createDiv({ cls: "flash-sync-row-info" });
      info.createDiv({ cls: "flash-sync-row-name", text: name });
      info.createDiv({ cls: "flash-sync-row-desc", text: description });
      return element.createDiv({ cls: "flash-sync-row-control" });
    };
    const send = button(row("flash-sync-send-row", "qr-code", "Send settings to a new device", auth
      ? "Available once this device can sign in — a broken password would travel with the code."
      : "QR code and link, protected by a code phrase you say out loud."), "Create QR code",
    { cta: !auth && this.decisionCount() === 0, onClick: () => this.ctx.openExport() });
    send.disabled = auth;
    button(row("flash-sync-receive-row", "clipboard-paste", "Receive settings from another device", auth
      ? "The quickest fix if another device already syncs."
      : "Paste a transfer code. You see a preview before anything is saved."), "Paste code", { onClick: () => this.ctx.openImport() });
  }

  private renderAppearance(region: HTMLElement): void {
    groupHeading(region, "Appearance");
    const card = region.createDiv({ cls: "flash-sync-card" });
    const row = card.createDiv({ cls: "flash-sync-row flash-sync-status-bar-row" });
    const info = row.createDiv({ cls: "flash-sync-row-info" });
    info.createDiv({ cls: "flash-sync-row-name", text: "Status bar" });
    info.createDiv({ cls: "flash-sync-row-desc", text: "Minimal shows only the icon. Extended adds the status text." });
    const preview = info.createDiv({ cls: "flash-sync-preview-line" });
    preview.createSpan({ cls: "flash-sync-muted", text: "Preview" });
    this.previewEl = preview.createSpan({ cls: "flash-sync-status-preview", attr: { "aria-label": "Status bar preview" } });
    this.renderPreview();

    const group = row.createDiv({ cls: "flash-sync-row-control" }).createDiv({ cls: "flash-sync-segmented-control",
      attr: { role: "radiogroup", "aria-label": "Status bar presentation" } });
    const current = this.previewMode ?? this.ctx.host.config.statusBarMode;
    for (const mode of ["minimal", "extended"] as const) {
      const option = group.createEl("label");
      const input = option.createEl("input", { attr: { type: "radio", name: "flash-sync-status-mode", value: mode } });
      input.checked = current === mode;
      option.createSpan({ text: mode === "minimal" ? "Minimal" : "Extended" });
      input.addEventListener("change", () => {
        if (!input.checked) return;
        this.previewMode = mode;
        this.renderPreview();
        void this.saveMode(mode);
      });
    }
    if (Platform.isPhone) {
      region.createEl("p", { cls: "flash-sync-hint", text: "Obsidian hides the status bar on phones — this applies on tablets and desktop." });
    }
  }

  private renderPreview(): void {
    const preview = this.previewEl;
    if (!preview) return;
    const presentation = statusPresentation(this.ctx.host.status);
    preview.empty();
    icon(preview, presentation.icon);
    if ((this.previewMode ?? this.ctx.host.config.statusBarMode) === "extended") preview.createSpan({ text: presentation.text });
  }

  private async saveMode(mode: StatusBarMode): Promise<void> {
    const outcome = await this.ctx.host.applyAdvancedUpdate({ statusBarMode: mode });
    if (this.previewMode === mode) this.previewMode = undefined;
    if (outcome.kind === "persistence-error") {
      new Notice(`Could not save settings: ${outcome.message}`);
      this.ctx.rerender();
    }
  }
}
