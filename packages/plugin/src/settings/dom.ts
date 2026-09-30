import { setIcon, type App } from "obsidian";
import type { SettingsHost, SettingsSection } from "./model.js";
import type { StatusFact } from "./status-facts.js";

/** What every section renderer may ask of the settings tab. */
export interface SectionContext {
  readonly app: App;
  readonly host: SettingsHost;
  readonly mobile: boolean;
  openSection(section: SettingsSection, focus?: "password"): void;
  openImport(): void;
  openExport(): void;
  reloadConflicts(): Promise<void>;
  rerender(): void;
}

export function icon(parent: HTMLElement, name: string, cls = "flash-sync-icon"): HTMLElement {
  const element = parent.createSpan({ cls, attr: { "aria-hidden": "true" } });
  setIcon(element, name);
  return element;
}

export interface ButtonOptions {
  cta?: boolean;
  cls?: string;
  icon?: string;
  label?: string;
  onClick: (button: HTMLButtonElement) => unknown;
}

/** A native button so theme styles and `mod-cta` apply; at most one CTA per view. */
export function button(parent: HTMLElement, text: string, options: ButtonOptions): HTMLButtonElement {
  const element = parent.createEl("button", { attr: { type: "button" } });
  if (options.icon) icon(element, options.icon);
  if (options.icon) element.createSpan({ text }); else element.textContent = text;
  if (options.cta) element.classList.add("mod-cta");
  if (options.cls) element.classList.add(...options.cls.split(" "));
  if (options.label) element.setAttribute("aria-label", options.label);
  element.addEventListener("click", () => {
    if (element.disabled) return;
    void options.onClick(element);
  });
  return element;
}

/** Runs an async action with the button disabled so it cannot be repeated while pending. */
export async function withDisabled(target: HTMLButtonElement, action: () => Promise<unknown>): Promise<void> {
  target.disabled = true;
  try { await action(); }
  finally { target.disabled = false; }
}

/** Status as dot plus text, so color never carries meaning alone. */
export function statusPill(parent: HTMLElement, fact: Pick<StatusFact, "tone" | "value">, cls = "flash-sync-pill"): HTMLElement {
  const pill = parent.createSpan({ cls: `${cls} flash-sync-tone-${fact.tone}` });
  pill.createSpan({ cls: "flash-sync-dot", attr: { "aria-hidden": "true" } });
  pill.createSpan({ text: fact.value });
  return pill;
}

export function groupHeading(parent: HTMLElement, text: string, iconName?: string): HTMLElement {
  const head = parent.createDiv({ cls: "flash-sync-group-head" });
  if (iconName) icon(head, iconName);
  head.createEl("h3", { text });
  return head;
}

export async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}
