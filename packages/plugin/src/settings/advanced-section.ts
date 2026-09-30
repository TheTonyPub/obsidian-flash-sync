import { Notice, Setting } from "obsidian";
import { DEFAULT_INLINE_LIMIT } from "../blob-storage.js";
import { button, copyText, groupHeading, type SectionContext } from "./dom.js";
import type { AdvancedUpdate, SettingsApplyResult } from "./model.js";

const INLINE_LIMIT_HELP = "Notes up to this size are stored on the sync server. Larger files use attachment storage, " +
  "or stay on this device without it. Changing it reconnects sync.";

function shortId(id: string): string {
  return id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

/** Rarely changed controls; each one saves when it commits, with no Save or Discard step. */
export class AdvancedSection {
  private lastInlineLimitCommit?: string;

  constructor(private readonly ctx: SectionContext) {}

  render(panel: HTMLElement): void {
    const { host } = this.ctx;
    panel.createEl("p", { cls: "flash-sync-intro", text: "Defaults work for most vaults. Changes here save immediately." });

    groupHeading(panel, "Sync");
    const limitRow = new Setting(panel.createDiv({ cls: "flash-sync-card" })).setName("Inline note limit").setDesc(INLINE_LIMIT_HELP);
    limitRow.controlEl.classList.add("flash-sync-stacked-control");
    const unit = limitRow.controlEl.createDiv({ cls: "flash-sync-unit-input" });
    const input = unit.createEl("input", { attr: { type: "number", min: "1", step: "1", inputmode: "numeric",
      "aria-label": "Inline Markdown limit in KiB" } });
    input.value = String(host.config.inlineLimit / 1024);
    unit.createSpan({ cls: "flash-sync-unit", text: "KiB" });
    limitRow.controlEl.createDiv({ cls: "flash-sync-muted flash-sync-default", text: `Default: ${DEFAULT_INLINE_LIMIT / 1024} KiB` });
    const commit = (): void => {
      const value = input.value.trim();
      if (value === this.lastInlineLimitCommit) return;
      this.lastInlineLimitCommit = value;
      void this.save({ inlineLimit: Number(value) * 1024 }, limitRow).then((outcome) => {
        if ((outcome.kind === "validation-error" || outcome.kind === "persistence-error") && this.lastInlineLimitCommit === value) {
          this.lastInlineLimitCommit = undefined;
        }
      });
    };
    input.addEventListener("change", commit);
    input.addEventListener("blur", commit);

    groupHeading(panel, "This device");
    const deviceRow = new Setting(panel.createDiv({ cls: "flash-sync-card" })).setName("Device ID")
      .setDesc("Used in conflict copy names, so you can tell which device made a change.");
    deviceRow.controlEl.createEl("code", { cls: "flash-sync-mono", text: shortId(host.config.deviceId), attr: { title: host.config.deviceId } });
    button(deviceRow.controlEl, "Copy", { icon: "copy", label: "Copy device ID", onClick: async () => {
      await copyText(host.config.deviceId);
      new Notice("Device ID copied");
    } });

    groupHeading(panel, "Diagnostics");
    const diagnostics = panel.createDiv({ cls: "flash-sync-card flash-sync-diagnostics" });
    new Setting(diagnostics).setName("Debug logging")
      .setDesc("Writes connection, reconciliation and pending-change events to the developer console. Errors are always recorded.")
      .addToggle((toggle) => toggle.setValue(host.config.debugLogging).onChange((value) => { void this.save({ debugLogging: value }); }));
    const report = new Setting(diagnostics).setName("Status report")
      .setDesc("Status, queue counts and recent errors for a bug report. Server addresses are shortened; passwords and keys are never included.");
    button(report.controlEl, "Copy report", { label: "Copy status report", onClick: async () => {
      await copyText(host.statusReport());
      new Notice("Status report copied");
    } });
  }

  private async save(update: AdvancedUpdate, row?: Setting): Promise<SettingsApplyResult> {
    const outcome = await this.ctx.host.applyAdvancedUpdate(update);
    if (outcome.kind === "validation-error") {
      const message = outcome.errors.inlineLimitKiB;
      if (message && row) { row.setDesc(message); row.descEl.classList.add("flash-sync-field-error"); }
      return outcome;
    }
    if (row) { row.setDesc(INLINE_LIMIT_HELP); row.descEl.classList.remove("flash-sync-field-error"); }
    if (outcome.kind === "persistence-error") {
      new Notice(`Could not save settings: ${outcome.message}`);
      this.ctx.rerender();
    }
    return outcome;
  }
}
