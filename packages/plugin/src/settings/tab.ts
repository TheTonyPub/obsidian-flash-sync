import { App, Modal, Notice, Platform, Plugin, PluginSettingTab } from "obsidian";
import type { ConflictRecord } from "../local-store.js";
import { PLUGIN_ID } from "../plugin-identity.js";
import { AdvancedSection } from "./advanced-section.js";
import { button, icon } from "./dom.js";
import { connectionConfigured, draftFor, SETTINGS_SECTIONS, serverChanges, type EasySyncSettings, type SettingsApplyResult,
  type SettingsDraft, type SettingsHost, type SettingsSection } from "./model.js";
import { ServerSection, type ServerContext } from "./server-section.js";
import { serverNeedsAttention } from "./status-facts.js";
import { needsDecision, SyncSection } from "./sync-section.js";
import { ExportConfigModal, ImportConfigModal } from "./transfer-modals.js";

class DraftSwitchModal extends Modal {
  constructor(app: App, private readonly from: string, private readonly resolveChoice: (choice: "apply" | "discard" | "keep") => void) { super(app); }
  onOpen(): void {
    this.contentEl.empty();
    this.contentEl.createEl("h2", { text: "Unapplied changes" });
    this.contentEl.createEl("p", { text: `Apply changes in ${this.from}, discard them, or keep editing. Closing settings discards unapplied changes.` });
    const actions = this.contentEl.createDiv({ cls: "flash-sync-modal-actions" });
    button(actions, "Apply", { cta: true, onClick: () => this.finish("apply") });
    button(actions, "Discard", { onClick: () => this.finish("discard") });
    button(actions, "Keep editing", { onClick: () => this.finish("keep") });
  }
  onClose(): void { this.resolveChoice("keep"); }
  private finish(choice: "apply" | "discard" | "keep"): void { this.resolveChoice(choice); this.close(); }
}

export class EasySyncSettingTab extends PluginSettingTab {
  private unsubscribe?: () => void;
  private serverDraft?: SettingsDraft;
  private activeSection: SettingsSection = "sync";
  private tabList?: HTMLElement;
  private panel?: HTMLElement;
  private busy = false;
  private navigationDecisionPending = false;
  private pendingFocus?: "password";
  private conflicts?: ConflictRecord[];
  private conflictLoad = 0;
  private readonly syncSection: SyncSection;
  private readonly serverSection: ServerSection;
  private readonly advancedSection: AdvancedSection;

  constructor(app: App, private readonly plugin: Plugin & SettingsHost) {
    super(app, plugin);
    const context: ServerContext = {
      app,
      host: plugin,
      get mobile() { return Platform.isMobile; },
      openSection: (section, focus) => { void this.selectSection(section, focus); },
      openImport: () => { new ImportConfigModal(this.app, this.plugin, "").open(); },
      openExport: () => { new ExportConfigModal(this.app, this.plugin, Platform.isMobile).open(); },
      reloadConflicts: () => this.loadConflicts(),
      rerender: () => this.renderSection(),
      draft: () => this.currentDraft(),
      discardDraft: () => { this.clearServerDraft(); this.renderSection(); },
      saveDraft: () => this.applyServerDraft(),
    };
    this.syncSection = new SyncSection(context);
    this.serverSection = new ServerSection(context);
    this.advancedSection = new AdvancedSection(context);
  }

  hide(): void {
    this.unsubscribe?.(); this.unsubscribe = undefined;
    this.conflictLoad++;
    this.clearServerDraft();
  }

  onApplied(_settings: EasySyncSettings, section: SettingsSection | "all"): void {
    if (section === "server" || section === "all") this.clearServerDraft();
    else if (this.serverDraft && !this.isServerDirty()) this.serverDraft = undefined;
    if (!this.panel) return;
    if (section === "all") this.display();
    else if (section === this.activeSection) this.renderSection();
  }

  display(): void {
    const { containerEl } = this;
    const mobile = Platform.isMobile;
    containerEl.empty();
    const root = containerEl.createDiv({ cls: mobile ? "flash-sync-settings flash-sync-mobile" : "flash-sync-settings" });
    this.renderHeader(root);

    this.tabList = root.createDiv({ cls: mobile ? "flash-sync-tabs flash-sync-segmented" : "flash-sync-tabs",
      attr: { role: "tablist", "aria-label": `${PLUGIN_ID} settings` } });
    for (const [section, label] of SETTINGS_SECTIONS) {
      const tab = this.tabList.createEl("button", { attr: { type: "button", role: "tab", id: `flash-sync-tab-${section}`,
        "data-section": section, "aria-controls": `flash-sync-panel-${section}` } });
      tab.createSpan({ cls: "flash-sync-tab-label", text: label });
      if (section === "sync") tab.createSpan({ cls: "flash-sync-tab-badge" }).hidden = true;
      if (section === "server") {
        const marker = tab.createSpan({ cls: "flash-sync-tab-marker" });
        marker.createSpan({ cls: "flash-sync-visually-hidden", text: "Server needs attention" });
        marker.hidden = true;
      }
      tab.addEventListener("click", () => { void this.selectSection(section); });
      tab.addEventListener("keydown", (event) => this.onTabKey(event as KeyboardEvent));
    }

    this.panel = root.createDiv({ cls: "flash-sync-panel", attr: { role: "tabpanel" } });
    this.panel.inert = this.busy;
    this.renderSection();
    this.updateNavigation();
    this.unsubscribe?.();
    this.unsubscribe = this.plugin.status.subscribe(() => this.onStatus());
    void this.loadConflicts();
  }

  private renderHeader(root: HTMLElement): void {
    const { config } = this.plugin;
    const header = root.createDiv({ cls: "flash-sync-header" });
    const title = header.createDiv({ cls: "flash-sync-title" });
    // Obsidian's settings pane hides the first h1; use its visible native section heading style.
    title.createEl("h2", { text: PLUGIN_ID, cls: "flash-sync-heading" });
    title.createEl("p", { cls: "flash-sync-subtitle", text: "Syncs this vault through your own server" });
    if (!connectionConfigured(config)) return;
    const chip = header.createDiv({ cls: "flash-sync-vault-chip",
      attr: { title: config.boundVaultId ? "This device is bound to this vault" : "Vault ID" } });
    icon(chip, config.boundVaultId ? "lock" : "vault");
    chip.createSpan({ text: "Vault" });
    chip.createEl("code", { text: config.vaultId });
  }

  private onTabKey(event: KeyboardEvent): void {
    const count = SETTINGS_SECTIONS.length;
    const current = SETTINGS_SECTIONS.findIndex(([section]) => section === this.activeSection);
    const next = event.key === "Home" ? 0 : event.key === "End" ? count - 1
      : event.key === "ArrowRight" ? (current + 1) % count
        : event.key === "ArrowLeft" ? (current + count - 1) % count : -1;
    if (next < 0) return;
    event.preventDefault();
    void this.selectSection(SETTINGS_SECTIONS[next]![0]).then(() => {
      this.containerEl.querySelector<HTMLButtonElement>(`button[role="tab"][aria-controls="flash-sync-panel-${this.activeSection}"]`)?.focus();
    });
  }

  private onStatus(): void {
    this.updateNavigation();
    if (this.activeSection === "sync") this.syncSection.refresh();
    else if (this.activeSection === "server") this.serverSection.refresh();
    void this.loadConflicts();
  }

  private async loadConflicts(): Promise<void> {
    const load = ++this.conflictLoad;
    let conflicts: ConflictRecord[];
    try { conflicts = await this.plugin.getConflicts(); }
    catch { return; }
    if (load !== this.conflictLoad) return;
    this.conflicts = conflicts;
    this.updateNavigation();
    if (this.panel && this.activeSection === "sync") this.syncSection.setConflicts(conflicts);
  }

  private updateNavigation(): void {
    if (!this.tabList) return;
    const decisions = (this.conflicts ?? []).filter(needsDecision).length;
    for (const tab of Array.from(this.tabList.querySelectorAll<HTMLButtonElement>("button[role=tab]"))) {
      const section = tab.getAttribute("data-section");
      const selected = section === this.activeSection;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      for (const child of Array.from(tab.children) as HTMLElement[]) {
        if (child.classList.contains("flash-sync-tab-badge")) {
          child.textContent = decisions ? String(decisions) : "";
          child.hidden = decisions === 0;
          child.setAttribute("aria-label", `${decisions} ${decisions === 1 ? "conflict needs" : "conflicts need"} a decision`);
        } else if (child.classList.contains("flash-sync-tab-marker")) {
          child.hidden = !serverNeedsAttention(this.plugin.status);
        }
      }
    }
  }

  private renderSection(): void {
    const panel = this.panel;
    if (!panel) return;
    panel.empty();
    panel.id = `flash-sync-panel-${this.activeSection}`;
    panel.setAttribute("aria-labelledby", `flash-sync-tab-${this.activeSection}`);
    const focus = this.pendingFocus;
    this.pendingFocus = undefined;
    if (this.activeSection === "sync") {
      this.syncSection.render(panel);
      if (this.conflicts) this.syncSection.setConflicts(this.conflicts);
    } else if (this.activeSection === "server") {
      this.serverSection.render(panel, focus);
    } else {
      this.advancedSection.render(panel);
    }
  }

  private async selectSection(next: SettingsSection, focus?: "password"): Promise<void> {
    if (this.busy || this.navigationDecisionPending) return;
    if (next === this.activeSection) {
      if (focus) { this.pendingFocus = focus; this.renderSection(); }
      return;
    }
    if (this.activeSection === "server" && this.isServerDirty()) {
      this.navigationDecisionPending = true;
      let choice: "apply" | "discard" | "keep";
      try {
        choice = await new Promise<"apply" | "discard" | "keep">((resolve) => {
          new DraftSwitchModal(this.app, "Server", resolve).open();
        });
      } finally { this.navigationDecisionPending = false; }
      if (choice === "keep") return;
      if (choice === "discard") this.clearServerDraft();
      if (choice === "apply") {
        const outcome = await this.applyServerDraft();
        if (outcome.kind === "validation-error" || outcome.kind === "persistence-error") return;
      }
    }
    this.activeSection = next;
    this.pendingFocus = focus;
    this.display();
  }

  private currentDraft(): SettingsDraft {
    this.serverDraft ??= draftFor(this.plugin.config);
    return this.serverDraft;
  }

  private isServerDirty(): boolean {
    return Boolean(this.serverDraft && serverChanges(this.serverDraft, this.plugin.config).length);
  }

  private clearServerDraft(): void {
    this.serverDraft = undefined;
    this.serverSection.reset();
  }

  private async applyServerDraft(): Promise<SettingsApplyResult> {
    const draft = this.currentDraft();
    this.busy = true;
    if (this.panel) { this.panel.inert = true; this.panel.setAttribute("aria-busy", "true"); }
    let outcome: SettingsApplyResult;
    try { outcome = await this.plugin.applyDraft(draft, "server"); }
    finally {
      this.busy = false;
      if (this.panel) { this.panel.inert = false; this.panel.removeAttribute("aria-busy"); }
    }
    if (outcome.kind === "validation-error") {
      if (this.activeSection === "server") this.serverSection.showErrors(outcome.errors);
      return outcome;
    }
    if (outcome.kind === "persistence-error") new Notice(`Could not save settings: ${outcome.message}`);
    else if (outcome.kind === "connection-error") new Notice("Settings saved. Connection failed.");
    else if (outcome.kind === "not-configured") new Notice("Settings saved. Sync is not configured.");
    else new Notice("Settings saved.");
    return outcome;
  }
}
