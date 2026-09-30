import { afterEach, describe, expect, it, vi } from "vitest";
import { Platform } from "obsidian";
import { decryptTransfer, encryptTransfer, type TransferConfig } from "../../packages/plugin/src/config-transfer.js";

const ui = vi.hoisted(() => {
  interface FakeApp {
    secretStorage: { getSecret: (key: string) => string | null; setSecret: (key: string, value: string) => void };
    workspace: { onLayoutReady: (callback: () => void) => void; getActiveViewOfType: (type: unknown) => null };
    vault: { adapter: { exists: (path: string) => Promise<boolean>; read: (path: string) => Promise<string> }; configDir: string };
  }
  const notices: string[] = [];
  const modals: FakeModal[] = [];
  const setIcon = vi.fn();
  let focused: FakeElement | undefined;
  const recordFocus = (element: FakeElement): void => { focused = element; };

  class FakeElement {
    readonly children: FakeElement[] = [];
    readonly attributes = new Map<string, string>();
    readonly listeners = new Map<string, Array<(event: Record<string, unknown>) => void>>();
    readonly classList = {
      add: (...names: string[]) => { for (const name of names) if (!this.classes.includes(name)) this.classes.push(name); },
      remove: (...names: string[]) => {
        for (const name of names) { const index = this.classes.indexOf(name); if (index >= 0) this.classes.splice(index, 1); }
      },
      toggle: (name: string, force?: boolean) => {
        const enabled = force ?? !this.classes.includes(name);
        if (enabled) this.classList.add(name); else this.classList.remove(name);
        return enabled;
      },
      contains: (name: string) => this.classes.includes(name),
    };
    readonly classes: string[] = [];
    parentElement?: FakeElement;
    name = "";
    value = "";
    type = "";
    autocomplete = "";
    placeholder = "";
    spellcheck = true;
    checked = false;
    disabled = false;
    hidden = false;
    inert = false;
    tabIndex = 0;
    readonly style = { color: "" };
    id = "";
    private ownText = "";

    constructor(public tagName: string) {}

    get textContent(): string { return this.ownText + this.children.map((child) => child.textContent).join(""); }
    set textContent(value: string) { this.ownText = value; this.empty(); }

    empty(): void { this.children.length = 0; }
    createDiv(options: Record<string, unknown> = {}): FakeElement { return this.createEl("div", options); }
    createSpan(options: Record<string, unknown> = {}): FakeElement { return this.createEl("span", options); }
    createEl(tag: string, options: Record<string, unknown> = {}): FakeElement {
      const element = new FakeElement(tag);
      element.parentElement = this;
      if (typeof options.text === "string") element.ownText = options.text;
      if (typeof options.cls === "string") element.classes.push(...options.cls.split(" "));
      if (Array.isArray(options.cls)) element.classes.push(...options.cls as string[]);
      const attrs = options.attr as Record<string, string> | undefined;
      for (const [key, value] of Object.entries(attrs ?? {})) element.setAttribute(key, value);
      this.children.push(element);
      return element;
    }
    setAttribute(name: string, value: string): void {
      this.attributes.set(name, value);
      if (name === "type") this.type = value;
      if (name === "value") this.value = value;
    }
    getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
    removeAttribute(name: string): void { this.attributes.delete(name); }
    addEventListener(name: string, listener: (event: Record<string, unknown>) => void): void {
      const listeners = this.listeners.get(name) ?? [];
      listeners.push(listener);
      this.listeners.set(name, listeners);
    }
    dispatch(name: string, values: Record<string, unknown> = {}): void {
      const event: Record<string, unknown> = { currentTarget: this, target: this, ...values };
      event.preventDefault = () => { event.defaultPrevented = true; };
      event.stopPropagation = () => {};
      for (const listener of this.listeners.get(name) ?? []) listener(event);
    }
    click(): void { this.dispatch("click"); }
    focus(): void { recordFocus(this); }
    querySelectorAll<T extends FakeElement = FakeElement>(selector: string): T[] {
      const match = (element: FakeElement): boolean => {
        if (selector === "input") return element.tagName === "input";
        if (selector === "select") return element.tagName === "select";
        if (selector === "textarea") return element.tagName === "textarea";
        if (selector === "img") return element.tagName === "img";
        if (selector === "[role=tabpanel]") return element.getAttribute("role") === "tabpanel";
        if (selector === "[role=tablist]") return element.getAttribute("role") === "tablist";
        if (selector === "button[role=tab]" || selector === 'button[role="tab"]')
          return element.tagName === "button" && element.getAttribute("role") === "tab";
        const tab = selector.match(/^button\[role="tab"\]\[aria-controls="(.+)"\]$/);
        if (tab) return element.tagName === "button" && element.getAttribute("role") === "tab" && element.getAttribute("aria-controls") === tab[1];
        return false;
      };
      return this.children.flatMap((child) => [...(match(child) ? [child as T] : []), ...child.querySelectorAll<T>(selector)]);
    }
    querySelector<T extends FakeElement = FakeElement>(selector: string): T | null {
      return this.querySelectorAll<T>(selector)[0] ?? null;
    }
    toggle(show: boolean): void { this.hidden = !show; }
  }

  class FakePlugin {
    savedData: unknown = null;
    readonly settingTabs: FakePluginSettingTab[] = [];
    constructor(readonly app: FakeApp) {}
    async loadData(): Promise<unknown> { return this.savedData; }
    async saveData(data: unknown): Promise<void> { this.savedData = data; }
    readonly statusItems: FakeElement[] = [];
    addStatusBarItem(): FakeElement { const item = new FakeElement("div"); this.statusItems.push(item); return item; }
    addSettingTab(tab: FakePluginSettingTab): void { this.settingTabs.push(tab); }
    register(): void {}
    registerObsidianProtocolHandler(): void {}
    registerEditorExtension(): void {}
    registerDomEvent(): void {}
  }

  class FakePluginSettingTab {
    readonly containerEl = new FakeElement("div");
    constructor(readonly app: FakeApp, readonly plugin: unknown) {}
  }

  class FakeModal {
    readonly modalEl = new FakeElement("div");
    readonly contentEl = new FakeElement("div");
    closed = false;
    constructor(readonly app: unknown) { modals.push(this); }
    open(): void { (this as unknown as { onOpen?: () => void }).onOpen?.(); }
    close(): void { this.closed = true; (this as unknown as { onClose?: () => void }).onClose?.(); }
  }

  class FakeText {
    readonly inputEl = new FakeElement("input");
    private change?: (value: string) => void;
    setValue(value: string): this { this.inputEl.value = value; return this; }
    setPlaceholder(value: string): this { this.inputEl.placeholder = value; return this; }
    setDisabled(value: boolean): this { this.inputEl.disabled = value; return this; }
    onChange(callback: (value: string) => void): this {
      this.change = callback;
      this.inputEl.addEventListener("input", () => callback(this.inputEl.value));
      return this;
    }
    changeTo(value: string): void { this.inputEl.value = value; this.change?.(value); }
  }

  class FakeButton {
    readonly buttonEl: FakeElement;
    private clickHandler?: () => unknown;
    constructor(parent: FakeElement) { this.buttonEl = parent.createEl("button"); }
    setButtonText(value: string): this { this.buttonEl.textContent = value; return this; }
    setDisabled(value: boolean): this { this.buttonEl.disabled = value; return this; }
    setCta(): this { this.buttonEl.classList.add("mod-cta"); return this; }
    onClick(callback: () => unknown): this { this.clickHandler = callback; this.buttonEl.addEventListener("click", () => { void this.clickHandler?.(); }); return this; }
  }

  class FakeToggleComponent {
    readonly toggleEl: FakeElement;
    readonly inputEl: FakeElement;
    private change?: (value: boolean) => void;
    constructor(parent: FakeElement) {
      this.toggleEl = parent.createDiv({ cls: "checkbox-container" });
      this.inputEl = this.toggleEl.createEl("input", { attr: { type: "checkbox" } });
      this.inputEl.addEventListener("change", () => this.change?.(this.inputEl.checked));
    }
    getValue(): boolean { return this.inputEl.checked; }
    setValue(value: boolean): this { this.inputEl.checked = value; return this; }
    setDisabled(value: boolean): this { this.inputEl.disabled = value; return this; }
    onChange(callback: (value: boolean) => void): this { this.change = callback; return this; }
  }

  class FakeSetting {
    readonly settingEl: FakeElement;
    readonly infoEl: FakeElement;
    readonly nameEl: FakeElement;
    readonly descEl: FakeElement;
    readonly controlEl: FakeElement;
    constructor(parent: FakeElement) {
      this.settingEl = parent.createDiv({ cls: "setting-item" });
      this.infoEl = this.settingEl.createDiv();
      this.nameEl = this.infoEl.createDiv();
      this.descEl = this.infoEl.createDiv();
      this.controlEl = this.settingEl.createDiv();
    }
    setName(value: string): this { this.settingEl.name = value; this.settingEl.setAttribute("data-setting-name", value); this.nameEl.textContent = value; return this; }
    setDesc(value: string): this { this.descEl.textContent = value; return this; }
    setClass(value: string): this { this.settingEl.classList.add(value); return this; }
    addText(callback: (component: FakeText) => unknown): this { const component = new FakeText(); this.controlEl.children.push(component.inputEl); component.inputEl.parentElement = this.controlEl; callback(component); return this; }
    addTextArea(callback: (component: FakeText) => unknown): this { const component = new FakeText(); component.inputEl.tagName = "textarea"; this.controlEl.children.push(component.inputEl); component.inputEl.parentElement = this.controlEl; callback(component); return this; }
    addButton(callback: (component: FakeButton) => unknown): this { callback(new FakeButton(this.controlEl)); return this; }
    addToggle(callback: (component: FakeToggleComponent) => unknown): this { callback(new FakeToggleComponent(this.controlEl)); return this; }
  }

  class FakeNotice { constructor(message: string) { notices.push(message); } }

  return { FakeElement, FakePlugin, FakePluginSettingTab, FakeModal, FakeSetting, FakeToggleComponent, FakeNotice, notices, modals, setIcon,
    getFocused: () => focused, reset: () => { notices.length = 0; modals.length = 0; setIcon.mockClear(); focused = undefined; } };
});

vi.mock("obsidian", async (importOriginal) => {
  const actual = await importOriginal<typeof import("obsidian")>();
  return { ...actual, Plugin: ui.FakePlugin, PluginSettingTab: ui.FakePluginSettingTab, Modal: ui.FakeModal,
    Setting: ui.FakeSetting, ToggleComponent: ui.FakeToggleComponent, Notice: ui.FakeNotice, setIcon: ui.setIcon };
});

const connectVault = vi.hoisted(() => vi.fn(async () => { throw new Error("offline"); }));
vi.mock("../../packages/plugin/src/connection.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../packages/plugin/src/connection.js")>();
  return { ...actual, connectVault };
});

import EasySyncPlugin from "../../packages/plugin/src/main.js";

type El = InstanceType<typeof ui.FakeElement>;
const platform = Platform as unknown as { isMobile: boolean; isPhone: boolean };

function descendants(root: El): El[] {
  return root.children.flatMap((child) => [child, ...descendants(child)]);
}

function visible(element: El): boolean {
  for (let current: El | undefined = element; current; current = current.parentElement) if (current.hidden) return false;
  return true;
}

function findText(root: El, text: string): El {
  const result = descendants(root).find((element) => element.textContent === text);
  if (!result) throw new Error(`No element with text: ${text}`);
  return result;
}

function findSetting(root: El, name: string): El {
  const row = descendants(root).find((element) => element.getAttribute("data-setting-name") === name);
  if (!row) throw new Error(`No setting: ${name}`);
  return row;
}

function findSettingInput(root: El, name: string): El {
  const input = findSetting(root, name).querySelector("input");
  if (!input) throw new Error(`No input for setting: ${name}`);
  return input;
}

function buttons(root: El): El[] {
  return descendants(root).filter((element) => element.tagName === "button");
}

function findButton(root: El, text: string): El {
  const button = buttons(root).find((element) => element.textContent === text);
  if (!button) throw new Error(`No button with text: ${text}`);
  return button;
}

function hasButton(root: El, text: string): boolean {
  return buttons(root).some((element) => element.textContent === text && visible(element));
}

function byClass(root: El, cls: string): El {
  const element = descendants(root).find((candidate) => candidate.classes.includes(cls));
  if (!element) throw new Error(`No element with class: ${cls}`);
  return element;
}

async function createPlugin() {
  const secrets = new Map<string, string>();
  const vaultEntries = new Map<string, string>();
  const app = {
    secretStorage: { getSecret: (key: string) => secrets.get(key) ?? null, setSecret: (key: string, value: string) => secrets.set(key, value) },
    setting: { open: vi.fn(), openTabById: vi.fn() },
    workspace: { onLayoutReady: () => {}, getActiveViewOfType: () => null, openLinkText: vi.fn() },
    vault: {
      adapter: { exists: async () => false, read: async () => "" }, configDir: ".obsidian",
      getAbstractFileByPath: (path: string) => vaultEntries.has(path) ? {} : undefined,
      createFolder: vi.fn(async (path: string) => { vaultEntries.set(path, ""); }),
      create: vi.fn(async (path: string, content: string) => {
        if (vaultEntries.has(path)) throw new Error("already exists");
        vaultEntries.set(path, content);
      }),
    },
  };
  const plugin = new EasySyncPlugin(app as never, {} as never);
  await plugin.onload();
  const tab = (plugin as unknown as { settingTabs: Array<{ display: () => void; hide: () => void; containerEl: El }> }).settingTabs[0];
  tab.display();
  return { plugin, tab, app, secrets, vaultEntries };
}

/** A device that has connected before: bound vault, saved NATS password, reachable server. */
async function createConfiguredPlugin(options: { s3?: boolean } = {}) {
  const context = await createPlugin();
  const { plugin, secrets, tab } = context;
  secrets.set("saved-nats", "stored-nats-password");
  Object.assign(plugin.config, { vaultId: "VAULT_A", boundVaultId: "VAULT_A", server: "wss://sync.example.test",
    username: "user-test-a", passwordSecretKey: "saved-nats" });
  if (options.s3) {
    secrets.set("saved-s3", "stored-s3-secret");
    Object.assign(plugin.config, { s3Endpoint: "https://s3.example.test", s3Bucket: "vault-attachments", s3Region: "eu-west-1",
      s3AccessKeyId: "ACCESS-ID", s3SecretKeySecretKey: "saved-s3" });
    plugin.status.attachmentState = "CONFIGURED";
  }
  plugin.status.connectionState = "CONNECTED";
  plugin.status.connected = true;
  plugin.status.reconciled = true;
  plugin.status.refresh();
  tab.display();
  return context;
}

function stubConflicts(plugin: EasySyncPlugin, conflicts: unknown[], engine: Record<string, unknown> = {}, history: unknown[] = []) {
  (plugin as unknown as { store: unknown }).store = {
    unresolvedConflicts: vi.fn().mockResolvedValue(conflicts),
    conflictHistory: vi.fn().mockResolvedValue(history),
  };
  (plugin as unknown as { engine: unknown }).engine = { compareConflict: vi.fn(), keepRemote: vi.fn(), keepLocalCopy: vi.fn(),
    markResolved: vi.fn(), ...engine };
}

const conflict = (operationId: string, path: string, lifecycle: "unresolved" | "pending-sync" = "unresolved") => ({
  operationId, originalFileId: `file-${operationId}`, originalPath: path, copyFileId: `copy-${operationId}`,
  copyPath: path.replace(/\.md$/, ".conflict.md"), remoteRevision: 418, lifecycle,
});

function panelOf(tab: { containerEl: El }): El {
  return tab.containerEl.querySelector("[role=tabpanel]")!;
}

function tabs(tab: { containerEl: El }): El[] {
  return tab.containerEl.querySelectorAll('button[role="tab"]');
}

function stubClipboard(): { writeText: ReturnType<typeof vi.fn>; share?: ReturnType<typeof vi.fn> } {
  const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
  vi.stubGlobal("document", { hidden: false });
  vi.stubGlobal("window", {});
  vi.stubGlobal("navigator", { clipboard });
  return clipboard;
}

afterEach(() => {
  ui.reset();
  connectVault.mockClear();
  vi.unstubAllGlobals();
  platform.isMobile = false;
  platform.isPhone = false;
});

describe("settings sections", () => {
  it("opens on Sync and offers exactly Sync, Server and Advanced without a section picker", async () => {
    stubClipboard();
    const { tab } = await createPlugin();

    expect(findText(tab.containerEl, "flash-sync").tagName).toBe("h2");
    expect(tabs(tab).map((button) => button.getAttribute("data-section"))).toEqual(["sync", "server", "advanced"]);
    expect(tabs(tab).map((button) => byClass(button, "flash-sync-tab-label").textContent)).toEqual(["Sync", "Server", "Advanced"]);
    expect(tabs(tab)[0].getAttribute("aria-selected")).toBe("true");
    expect(panelOf(tab).id).toBe("flash-sync-panel-sync");
    expect(tab.containerEl.querySelector("select")).toBeNull();
    expect(tab.containerEl.textContent).not.toContain("Settings section");
  });

  it("moves between sections with arrow, Home and End keys and keeps focus on the selected tab", async () => {
    stubClipboard();
    const { tab } = await createPlugin();

    tabs(tab)[0].dispatch("keydown", { key: "ArrowRight" });
    await vi.waitFor(() => expect(ui.getFocused()).toBe(tabs(tab)[1]));
    expect(panelOf(tab).id).toBe("flash-sync-panel-server");
    tabs(tab)[1].dispatch("keydown", { key: "End" });
    await vi.waitFor(() => expect(ui.getFocused()).toBe(tabs(tab)[2]));
    tabs(tab)[2].dispatch("keydown", { key: "ArrowRight" });
    await vi.waitFor(() => expect(ui.getFocused()).toBe(tabs(tab)[0]));
    tabs(tab)[0].dispatch("keydown", { key: "ArrowLeft" });
    await vi.waitFor(() => expect(ui.getFocused()).toBe(tabs(tab)[2]));
    tabs(tab)[2].dispatch("keydown", { key: "Home" });
    await vi.waitFor(() => expect(ui.getFocused()).toBe(tabs(tab)[0]));
    expect(tabs(tab).map((button) => button.tabIndex)).toEqual([0, -1, -1]);
  });

  it("shows the count of conflicts needing a decision on the Sync tab", async () => {
    stubClipboard();
    const { plugin, tab } = await createConfiguredPlugin();
    stubConflicts(plugin, [conflict("a", "Projects/Weekly plan.md"), conflict("b", "Inbox/Reading list.md"),
      conflict("c", "Ideas.md", "pending-sync")]);

    tab.display();

    const badge = byClass(tabs(tab)[0], "flash-sync-tab-badge");
    await vi.waitFor(() => expect(badge.textContent).toBe("2"));
    expect(visible(badge)).toBe(true);
    expect(badge.getAttribute("aria-label")).toBe("2 conflicts need a decision");
    expect(tabs(tab)[0].getAttribute("aria-selected")).toBe("true");
  });

  it("marks the Server tab on a server or attachment-storage error", async () => {
    stubClipboard();
    const { plugin, tab } = await createConfiguredPlugin();
    const marker = byClass(tabs(tab)[1], "flash-sync-tab-marker");
    expect(visible(marker)).toBe(false);

    plugin.status.value = "AUTH_ERROR";
    plugin.status.connectionState = "AUTH_ERROR";
    plugin.status.refresh();
    expect(visible(marker)).toBe(true);
    expect(marker.textContent).toContain("needs attention");

    plugin.status.value = "SYNCED";
    plugin.status.connectionState = "CONNECTED";
    plugin.status.attachmentState = "TRANSFER_ERROR";
    plugin.status.refresh();
    expect(visible(marker)).toBe(true);

    plugin.status.attachmentState = "CONFIGURED";
    plugin.status.refresh();
    expect(visible(marker)).toBe(false);
  });

  it("uses a full-width segmented control on mobile", async () => {
    stubClipboard();
    platform.isMobile = true;
    const { tab } = await createPlugin();

    expect(tab.containerEl.querySelector("[role=tablist]")!.classes).toContain("flash-sync-segmented");
    expect(byClass(tab.containerEl, "flash-sync-settings").classes).toContain("flash-sync-mobile");
    expect(tab.containerEl.querySelector("select")).toBeNull();
  });
});

describe("Sync section", () => {
  it("names a sign-in failure, keeps local edits queued, and offers both recovery actions", async () => {
    stubClipboard();
    const { plugin, tab } = await createConfiguredPlugin();
    plugin.status.connected = false;
    plugin.status.value = "AUTH_ERROR";
    plugin.status.connectionState = "AUTH_ERROR";
    plugin.status.connectionError = "Authorization Violation";
    plugin.status.pending = 3;
    plugin.status.refresh();

    const summary = byClass(panelOf(tab), "flash-sync-summary");
    expect(summary.textContent).toContain("Can't sign in to the sync server");
    expect(summary.textContent).toContain("Your edits are safe on this device");
    expect(summary.textContent).toContain("Sign-in failed");
    expect(summary.textContent).toContain("3 notes");
    expect(hasButton(summary, "Update password")).toBe(true);
    expect(hasButton(summary, "Paste transfer code")).toBe(true);
    expect(hasButton(summary, "Sync now")).toBe(false);

    findButton(summary, "Paste transfer code").click();
    expect(ui.modals.at(-1)!.contentEl.textContent).toContain("Transfer code");

    findButton(summary, "Update password").click();
    await vi.waitFor(() => expect(panelOf(tab).id).toBe("flash-sync-panel-server"));
    expect(ui.getFocused()).toBe(findSettingInput(panelOf(tab), "Password"));
  });

  it("offers Paste transfer code first and Set up manually second on first run", async () => {
    stubClipboard();
    const { tab } = await createPlugin();
    const panel = panelOf(tab);

    expect(panel.textContent).toContain("This vault isn't syncing yet");
    const labels = buttons(panel).map((button) => button.textContent);
    expect(labels.indexOf("Paste transfer code")).toBeGreaterThanOrEqual(0);
    expect(labels.indexOf("Paste transfer code")).toBeLessThan(labels.indexOf("Set up manually"));
    expect(findButton(panel, "Paste transfer code").classes).toContain("mod-cta");
    expect(panel.textContent).not.toContain("Sync server");
    expect(hasButton(panel, "Sync now")).toBe(false);

    findButton(panel, "Set up manually").click();
    await vi.waitFor(() => expect(panelOf(tab).id).toBe("flash-sync-panel-server"));
  });

  it("summarizes a synchronized vault with server, attachments, queue and last reconciliation", async () => {
    stubClipboard();
    const { plugin, tab } = await createConfiguredPlugin({ s3: true });
    const syncNow = vi.spyOn(plugin, "syncNow").mockResolvedValue();
    plugin.status.lastReconciledAt = Date.now() - 90_000;
    plugin.status.refresh();

    const summary = byClass(panelOf(tab), "flash-sync-summary");
    expect(summary.textContent).toContain("Synchronized");
    expect(summary.textContent).toContain("checked 1 min ago");
    expect(summary.textContent).toContain("sync.example.test");
    expect(summary.textContent).toContain("S3 connected");
    expect(summary.textContent).toContain("Bucket vault-attachments");
    expect(summary.textContent).toContain("Nothing");
    findButton(summary, "Sync now").click();
    await vi.waitFor(() => expect(syncNow).toHaveBeenCalledOnce());
  });

  it("pairs the aggregate label with icon, text and color", async () => {
    stubClipboard();
    const { plugin, tab } = await createPlugin();
    const label = () => descendants(panelOf(tab)).find((element) => element.getAttribute("role") === "status")!;
    const summary = () => byClass(panelOf(tab), "flash-sync-summary");
    expect(label().getAttribute("aria-label")).toBe("Sync status: Not configured");
    expect(summary().classes).toContain("flash-sync-tone-gray");

    Object.assign(plugin.config, { server: "wss://sync.example.test", username: "user", passwordSecretKey: "key" });
    plugin.status.connectionState = "CONNECTED";
    plugin.status.connected = true;
    plugin.status.reconciled = true;
    plugin.status.refresh();
    expect(label().getAttribute("aria-label")).toBe("Sync status: Synchronized");
    expect(summary().classes).toContain("flash-sync-tone-green");
    expect(ui.setIcon).toHaveBeenCalledWith(expect.anything(), "cloud-check");

    plugin.status.pending = 2;
    plugin.status.refresh();
    expect(label().getAttribute("aria-label")).toBe("Sync status: Syncing");
    expect(summary().classes).toContain("flash-sync-tone-yellow");

    plugin.status.pending = 0;
    plugin.status.conflictPaths = ["note.conflict.md"];
    plugin.status.refresh();
    expect(label().getAttribute("aria-label")).toBe("Sync status: 1 conflict");
    expect(summary().classes).toContain("flash-sync-tone-yellow");

    plugin.status.conflictPaths = [];
    plugin.status.markError("write");
    expect(label().getAttribute("aria-label")).toBe("Sync status: Sync error");
    expect(summary().classes).toContain("flash-sync-tone-red");

    plugin.status.clearError("write");
    plugin.status.connected = false;
    plugin.status.connectionState = "OFFLINE";
    plugin.status.refresh();
    expect(label().getAttribute("aria-label")).toBe("Sync status: Disconnected");
    expect(summary().classes).toContain("flash-sync-tone-gray");
  });

  it("links an attachment storage error to Server", async () => {
    stubClipboard();
    const { plugin, tab } = await createConfiguredPlugin({ s3: true });
    expect(hasButton(panelOf(tab), "Check attachment settings")).toBe(false);

    plugin.status.attachmentState = "TRANSFER_ERROR";
    plugin.status.attachmentError = "Object transfer failed";
    plugin.status.refresh();
    expect(panelOf(tab).textContent).toContain("Transfer error");
    findButton(panelOf(tab), "Check attachment settings").click();
    await vi.waitFor(() => expect(panelOf(tab).id).toBe("flash-sync-panel-server"));
  });

  it("saves the status-bar mode immediately and updates the preview without Save or Discard", async () => {
    stubClipboard();
    const { plugin, tab } = await createConfiguredPlugin();
    const panel = panelOf(tab);
    const row = byClass(panel, "flash-sync-status-bar-row");
    const group = descendants(row).find((element) => element.getAttribute("role") === "radiogroup")!;
    const radio = (mode: string) => descendants(group).find((element) => element.tagName === "input" && element.getAttribute("value") === mode)!;
    const preview = byClass(row, "flash-sync-status-preview");

    expect(radio("extended").checked).toBe(true);
    expect(preview.textContent).toContain("Synchronized");
    expect(hasButton(panel, "Save and reconnect")).toBe(false);
    expect(hasButton(panel, "Discard")).toBe(false);

    radio("minimal").checked = true;
    radio("minimal").dispatch("change");
    expect(byClass(panelOf(tab), "flash-sync-status-preview").textContent).not.toContain("Synchronized");
    await vi.waitFor(() => expect(plugin.config.statusBarMode).toBe("minimal"));
    const item = (plugin as unknown as { statusItems: El[] }).statusItems[0];
    expect(item.textContent).toBe("");
  });

  it("restores the status-bar mode from persisted settings after a save failure", async () => {
    stubClipboard();
    const { plugin, tab } = await createConfiguredPlugin();
    vi.spyOn(plugin, "saveData").mockRejectedValueOnce(new Error("disk full"));
    const minimal = descendants(byClass(panelOf(tab), "flash-sync-status-bar-row"))
      .find((element) => element.tagName === "input" && element.getAttribute("value") === "minimal")!;

    minimal.checked = true;
    minimal.dispatch("change");
    await vi.waitFor(() => expect(ui.notices.at(-1)).toContain("Could not save settings"));
    expect(plugin.config.statusBarMode).toBe("extended");
    const restored = descendants(byClass(panelOf(tab), "flash-sync-status-bar-row"))
      .find((element) => element.tagName === "input" && element.getAttribute("value") === "extended");
    expect(restored?.checked).toBe(true);
  });

  it("renders Minimal and Extended status modes through one accessible click target", async () => {
    stubClipboard();
    const { plugin, app } = await createPlugin();
    const item = (plugin as unknown as { statusItems: El[] }).statusItems[0];
    const statusIcon = () => ui.setIcon.mock.calls.filter(([element]) => (element as El).parentElement === item).at(-1)?.[1];
    expect(item.getAttribute("aria-label")).toBe("Not configured");
    expect(item.textContent).toContain("Not configured");
    expect(statusIcon()).toBe("cloud-off");

    item.click();
    expect(app.setting.open).toHaveBeenCalledOnce();
    expect(app.setting.openTabById).toHaveBeenCalledWith("flash-sync");

    await plugin.applyAdvancedUpdate({ statusBarMode: "minimal" });
    plugin.status.connected = true;
    plugin.status.reconciled = true;
    plugin.status.refresh();
    expect(item.getAttribute("aria-label")).toBe("Synchronized");
    expect(item.textContent).toBe("");
    expect(statusIcon()).toBe("cloud-check");
  });
});

describe("Sync conflicts", () => {
  it("maps consequence-labelled choices to the existing confirmed actions and emphasizes comparison", async () => {
    stubClipboard();
    const { plugin, tab, app } = await createConfiguredPlugin();
    const keepRemote = vi.fn().mockResolvedValue(undefined);
    const keepLocalCopy = vi.fn().mockResolvedValue(undefined);
    const compareConflict = vi.fn();
    stubConflicts(plugin, [{ ...conflict("conflict-1", "Projects/2026/Weekly plan.md"), detectionRemoteHash: "remote",
      detectionCopyHash: "copy" }], { keepRemote, keepLocalCopy, compareConflict },
    [{ operationId: "conflict-1", event: "detected", context: "merge", createdAt: 1 }]);
    const createConflictReview = vi.spyOn(plugin, "createConflictReview").mockResolvedValue("review.md");
    tab.display();

    await vi.waitFor(() => expect(panelOf(tab).textContent).toContain("Weekly plan.md"));
    const panel = panelOf(tab);
    expect(panel.textContent).toContain("Conflicts · 1");
    expect(panel.textContent).toContain("Needs decision");
    expect(panel.textContent).toContain("Projects/2026");
    expect(panel.textContent).toContain("Server version");
    expect(panel.textContent).toContain("Replaces the note on this device. Your text stays in the conflict copy.");
    expect(panel.textContent).toContain("This device's version");
    expect(panel.textContent).toContain("Puts your text back into the note and uploads it over the server version.");
    expect(compareConflict).not.toHaveBeenCalled();

    const compare = findButton(panel, "Compare side by side");
    expect(compare.classes).toContain("mod-cta");
    expect(findButton(panel, "Keep server version").classes).not.toContain("mod-cta");
    compare.click();
    await vi.waitFor(() => expect(createConflictReview).toHaveBeenCalledWith("conflict-1"));

    findButton(panel, "Open conflict copy").click();
    await vi.waitFor(() => expect(app.workspace.openLinkText).toHaveBeenCalledWith("Projects/2026/Weekly plan.conflict.md", "", false));

    findButton(panel, "Keep server version").click();
    expect(ui.modals.at(-1)!.contentEl.textContent).toContain("Keep server version");
    findButton(ui.modals.at(-1)!.contentEl, "Confirm").click();
    await vi.waitFor(() => expect(keepRemote).toHaveBeenCalledWith("conflict-1"));

    findButton(panelOf(tab), "Keep my version").click();
    findButton(ui.modals.at(-1)!.contentEl, "Confirm").click();
    await vi.waitFor(() => expect(keepLocalCopy).toHaveBeenCalledWith("conflict-1"));

    findButton(panelOf(tab), "History").click();
    await vi.waitFor(() => expect(panelOf(tab).textContent).toContain("Conflict history"));
    await vi.waitFor(() => expect(panelOf(tab).textContent).toContain("detected: merge"));
  });

  it("keeps Mark resolved secondary to both choices and the comparison", async () => {
    stubClipboard();
    const { plugin, tab } = await createConfiguredPlugin();
    const markResolved = vi.fn().mockResolvedValue(undefined);
    stubConflicts(plugin, [{ ...conflict("conflict-blob", "image.png"), copyPath: "image.conflict.png", kind: "blob" }], { markResolved });
    tab.display();

    await vi.waitFor(() => expect(panelOf(tab).textContent).toContain("image.png"));
    const mark = findButton(panelOf(tab), "Mark resolved");
    expect(mark.classes).not.toContain("mod-cta");
    expect(mark.classes).toContain("flash-sync-quiet");
    const order = buttons(panelOf(tab)).map((button) => button.textContent);
    expect(order.indexOf("Mark resolved")).toBeGreaterThan(order.indexOf("Compare side by side"));
    expect(order.indexOf("Mark resolved")).toBeGreaterThan(order.indexOf("Keep my version"));

    mark.click();
    findButton(ui.modals.at(-1)!.contentEl, "Confirm").click();
    await vi.waitFor(() => expect(markResolved).toHaveBeenCalledWith("conflict-blob"));
  });

  it("shows a conflict pending sync as Waiting for sync without actions", async () => {
    stubClipboard();
    const { plugin, tab } = await createConfiguredPlugin();
    stubConflicts(plugin, [conflict("pending", "Ideas.md", "pending-sync")]);
    tab.display();

    await vi.waitFor(() => expect(panelOf(tab).textContent).toContain("Ideas.md"));
    const item = byClass(panelOf(tab), "flash-sync-conflict");
    expect(item.textContent).toContain("Waiting for sync");
    buttons(item)[0]!.click();
    for (const label of ["Keep server version", "Keep my version", "Compare side by side", "Open conflict copy", "Mark resolved"]) {
      expect(hasButton(item, label)).toBe(false);
    }
  });

  it("shows a one-line empty state and a history link without conflicts", async () => {
    stubClipboard();
    const { plugin, tab } = await createConfiguredPlugin();
    stubConflicts(plugin, []);
    tab.display();

    await vi.waitFor(() => expect(panelOf(tab).textContent).toContain("No conflicts"));
    expect(hasButton(panelOf(tab), "History")).toBe(true);
    findButton(panelOf(tab), "History").click();
    await vi.waitFor(() => expect(panelOf(tab).textContent).toContain("No conflict history yet."));
  });

  it("opens conflict choices in a sheet on mobile", async () => {
    stubClipboard();
    platform.isMobile = true;
    const { plugin, tab } = await createConfiguredPlugin();
    const keepRemote = vi.fn().mockResolvedValue(undefined);
    stubConflicts(plugin, [conflict("conflict-1", "Projects/Weekly plan.md")], { keepRemote });
    tab.display();

    await vi.waitFor(() => expect(panelOf(tab).textContent).toContain("Weekly plan.md"));
    expect(hasButton(panelOf(tab), "Keep server version")).toBe(false);
    byClass(panelOf(tab), "flash-sync-conflict-head").click();
    const sheet = ui.modals.at(-1)!;
    expect(sheet.modalEl.classes).toContain("flash-sync-sheet");
    expect(sheet.contentEl.textContent).toContain("Weekly plan.md");
    expect(findButton(sheet.contentEl, "Compare side by side").classes).toContain("mod-cta");
    findButton(sheet.contentEl, "Keep server version").click();
    findButton(ui.modals.at(-1)!.contentEl, "Confirm").click();
    await vi.waitFor(() => expect(keepRemote).toHaveBeenCalledWith("conflict-1"));
  });

  it("creates a unique, opened review snapshot outside sync capture", async () => {
    stubClipboard();
    const { plugin, app, vaultEntries } = await createPlugin();
    (plugin as unknown as { store: unknown; engine: unknown }).store = {
      unresolvedConflicts: vi.fn().mockResolvedValue([{ operationId: "conflict-note", originalFileId: "file", originalPath: "long/path/note.md",
        copyFileId: "copy", copyPath: "long/path/note.conflict.md", remoteRevision: 3, lifecycle: "unresolved" }]),
    };
    (plugin as unknown as { engine: unknown }).engine = { compareConflict: vi.fn().mockResolvedValue({
      remote: { path: "long/path/note.md", hash: "remote", size: 4, revision: 3, content: "old\n" },
      local: { path: "long/path/note.conflict.md", hash: "copy", size: 4, content: "new\n" }, stale: { remote: false, local: false },
    }) };

    const first = await plugin.createConflictReview("conflict-note");
    const second = await plugin.createConflictReview("conflict-note");
    expect(first).toMatch(/^Flash Sync Conflict Reviews\/note\.md-/);
    expect(second).not.toBe(first);
    expect(vaultEntries.get(first)).toContain("# Conflict review: note.md");
    expect(vaultEntries.get(first)).toContain("-old");
    expect(vaultEntries.get(first)).toContain("+new");
    expect(app.workspace.openLinkText).toHaveBeenCalledWith(first, "", false);
  });

  it("caps a long source basename before creating its unique review snapshot", async () => {
    stubClipboard();
    const { plugin } = await createPlugin();
    const basename = `${"a".repeat(400)}.md`;
    (plugin as unknown as { store: unknown; engine: unknown }).store = {
      unresolvedConflicts: vi.fn().mockResolvedValue([{ operationId: "long-name", originalFileId: "file", originalPath: basename,
        copyFileId: "copy", copyPath: "copy.md", remoteRevision: 1, lifecycle: "unresolved" }]),
    };
    (plugin as unknown as { engine: unknown }).engine = { compareConflict: vi.fn().mockResolvedValue({
      remote: { path: basename, hash: "remote", size: 1, content: "a" },
      local: { path: "copy.md", hash: "copy", size: 1, content: "b" }, stale: { remote: false, local: false },
    }) };

    const path = await plugin.createConflictReview("long-name");
    expect(path.split("/").at(-1)!.length).toBeLessThan(255);
  });
});

describe("settings transfer", () => {
  async function waitForLink(modal: InstanceType<typeof ui.FakeModal>, clipboard: { writeText: ReturnType<typeof vi.fn> }) {
    await vi.waitFor(() => expect(modal.contentEl.querySelector("img")).not.toBeNull(), { timeout: 10_000 });
    findButton(modal.contentEl, "Copy link").click();
    await vi.waitFor(() => expect(clipboard.writeText).toHaveBeenCalled());
    return clipboard.writeText.mock.calls.at(-1)![0] as string;
  }

  it("protects the QR code and link with a generated phrase that is not in the link", async () => {
    const clipboard = stubClipboard();
    const { tab } = await createConfiguredPlugin({ s3: true });
    const send = byClass(panelOf(tab), "flash-sync-send-row");
    expect(send.textContent).toContain("Send settings to a new device");
    findButton(send, "Create QR code").click();

    const modal = ui.modals.at(-1)!;
    const phraseInput = descendants(modal.contentEl).find((element) => element.getAttribute("aria-label") === "Code phrase")!;
    const phrase = phraseInput.value;
    expect(phrase).toMatch(/^[2-9A-HJ-NP-Z]{4}(?:-[2-9A-HJ-NP-Z]{4}){3}$/);
    expect(phraseInput.type).not.toBe("password");
    const link = await waitForLink(modal, clipboard);

    expect(link.startsWith("obsidian://flash-sync-import?data=1.")).toBe(true);
    expect(link).not.toContain(phrase);
    expect(link).not.toContain("stored-nats-password");
    const payload = decodeURIComponent(link.split("data=")[1]!);
    await expect(decryptTransfer(payload, phrase)).resolves.toMatchObject({ vaultId: "VAULT_A", natsPassword: "stored-nats-password" });
    expect(modal.contentEl.textContent).toContain("Vault VAULT_A, server address and username");
    expect(modal.contentEl.textContent).toContain("Password, encrypted with the phrase");
    expect(modal.contentEl.textContent).toContain("Attachment storage (S3) and its keys");

    findButton(modal.contentEl, "Copy code only").click();
    await vi.waitFor(() => expect(clipboard.writeText).toHaveBeenLastCalledWith(payload));
    expect(hasButton(modal.contentEl, "Share…")).toBe(false);
  });

  it("lets the user replace the generated phrase", async () => {
    const clipboard = stubClipboard();
    const { tab } = await createConfiguredPlugin();
    findButton(panelOf(tab), "Create QR code").click();
    const modal = ui.modals.at(-1)!;
    await waitForLink(modal, clipboard);
    const phraseInput = descendants(modal.contentEl).find((element) => element.getAttribute("aria-label") === "Code phrase")!;

    phraseInput.value = "short";
    phraseInput.dispatch("change");
    await vi.waitFor(() => expect(modal.contentEl.textContent).toContain("at least eight characters"));
    expect(findButton(modal.contentEl, "Copy link").disabled).toBe(true);

    phraseInput.value = "our own shared phrase";
    phraseInput.dispatch("change");
    const link = await waitForLink(modal, clipboard);
    await expect(decryptTransfer(decodeURIComponent(link.split("data=")[1]!), "our own shared phrase")).resolves.toMatchObject({ vaultId: "VAULT_A" });

    const previous = phraseInput.value;
    findButton(modal.contentEl, "New phrase").click();
    expect(phraseInput.value).not.toBe(previous);
    expect(phraseInput.value).toMatch(/^[2-9A-HJ-NP-Z]{4}(?:-[2-9A-HJ-NP-Z]{4}){3}$/);
  });

  it("keeps an unprotected export behind an explicit, warned opt-out", async () => {
    stubClipboard();
    const { tab } = await createConfiguredPlugin();
    findButton(panelOf(tab), "Create QR code").click();
    const modal = ui.modals.at(-1)!;
    expect(modal.contentEl.textContent).not.toContain("Unprotected — contains readable credentials.");

    findButton(modal.contentEl, "Create without a phrase…").click();
    const checkbox = modal.contentEl.querySelectorAll("input").find((input) => input.getAttribute("type") === "checkbox")!;
    expect(checkbox.checked).toBe(false);
    expect(modal.contentEl.textContent).toContain("Anyone who sees the QR code or link");

    checkbox.checked = true;
    checkbox.dispatch("change");
    // QR generation is CPU-bound; under a loaded CI runner it can exceed the default 1 s.
    await vi.waitFor(() => expect(modal.contentEl.textContent).toContain("Unprotected — contains readable credentials."),
      { timeout: 10_000 });
    expect(modal.contentEl.textContent).toContain("Password, readable by anyone with the code");
  });

  it("reports a missing saved password instead of creating a code", async () => {
    stubClipboard();
    const { tab, secrets } = await createConfiguredPlugin();
    secrets.clear();
    findButton(panelOf(tab), "Create QR code").click();
    const modal = ui.modals.at(-1)!;
    await vi.waitFor(() => expect(modal.contentEl.textContent).toContain("NATS password is missing"));
    expect(modal.contentEl.querySelector("img")).toBeNull();
  });

  it("offers the share sheet on mobile when available", async () => {
    const clipboard = stubClipboard();
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard, share });
    platform.isMobile = true;
    const { tab } = await createConfiguredPlugin();
    findButton(panelOf(tab), "Create QR code").click();
    const modal = ui.modals.at(-1)!;
    const link = await waitForLink(modal, clipboard);

    findButton(modal.contentEl, "Share…").click();
    await vi.waitFor(() => expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: link })));
    expect(JSON.stringify(share.mock.calls[0])).not.toContain(
      descendants(modal.contentEl).find((element) => element.getAttribute("aria-label") === "Code phrase")!.value);
  });

  it("disables Send settings with an explanation while credentials fail and keeps Receive available", async () => {
    stubClipboard();
    const { plugin, tab } = await createConfiguredPlugin();
    plugin.status.connected = false;
    plugin.status.value = "AUTH_ERROR";
    plugin.status.connectionState = "AUTH_ERROR";
    plugin.status.refresh();

    const send = byClass(panelOf(tab), "flash-sync-send-row");
    expect(findButton(send, "Create QR code").disabled).toBe(true);
    expect(send.textContent).toContain("Available once this device can sign in");
    const receive = byClass(panelOf(tab), "flash-sync-receive-row");
    expect(findButton(receive, "Paste code").disabled).toBe(false);
    findButton(receive, "Paste code").click();
    expect(ui.modals.at(-1)!.contentEl.textContent).toContain("Transfer code");
  });

  it("previews imported settings without exposing secrets or saving before explicit import", async () => {
    stubClipboard();
    const { plugin, tab, secrets } = await createPlugin();
    const before = { ...plugin.config };
    const transfer: TransferConfig = { vaultId: "IMPORT_VAULT", server: "wss://sync.example.test", username: "alice",
      natsPassword: "nats-preview-secret", s3Endpoint: "https://s3.example.test", s3Bucket: "attachments",
      s3Region: "eu-west-1", s3AccessKeyId: "access-preview-secret", s3SecretKey: "s3-preview-secret", inlineLimit: 262144 };
    const code = await encryptTransfer(transfer, "");

    findButton(panelOf(tab), "Paste transfer code").click();
    const modal = ui.modals.at(-1)!;
    const textarea = modal.contentEl.querySelector("textarea")!;
    textarea.value = code;
    textarea.dispatch("input");
    findButton(modal.contentEl, "Preview settings").click();
    await vi.waitFor(() => expect(modal.contentEl.textContent).toContain("Vault: IMPORT_VAULT"));

    expect(modal.contentEl.textContent).toContain("Server: wss://sync.example.test");
    expect(modal.contentEl.textContent).toContain("Attachments: attachments (https://s3.example.test)");
    expect(modal.contentEl.textContent).not.toContain(transfer.natsPassword);
    expect(modal.contentEl.textContent).not.toContain(transfer.s3AccessKeyId);
    expect(modal.contentEl.textContent).not.toContain(transfer.s3SecretKey);
    expect(modal.contentEl.textContent).toContain("Import and connect");
    expect(plugin.config).toEqual(before);
    expect(secrets.size).toBe(0);
    expect(connectVault).not.toHaveBeenCalled();
  });
});

describe("Server section", () => {
  function openServer(tab: { containerEl: El }) {
    tabs(tab)[1].click();
    return panelOf(tab);
  }

  it("marks an edited field and shows the unsaved change bar until saved or discarded", async () => {
    stubClipboard();
    const { plugin, tab } = await createConfiguredPlugin();
    const panel = openServer(tab);
    const bar = byClass(panel, "flash-sync-save-bar");
    const edited = () => byClass(findSetting(panelOf(tab), "Server address"), "flash-sync-edited");
    expect(visible(bar)).toBe(false);
    expect(visible(edited())).toBe(false);

    const server = findSettingInput(panel, "Server address");
    server.value = "wss://sync.example.test:8443";
    server.dispatch("input");

    expect(visible(edited())).toBe(true);
    expect(visible(bar)).toBe(true);
    expect(bar.textContent).toContain("1 unsaved change");
    expect(bar.textContent).toContain("Server address");
    expect(visible(byClass(findSetting(panel, "Username"), "flash-sync-edited"))).toBe(false);

    findButton(bar, "Discard").click();
    expect(visible(byClass(panelOf(tab), "flash-sync-save-bar"))).toBe(false);
    expect(findSettingInput(panelOf(tab), "Server address").value).toBe("wss://sync.example.test");
    expect(plugin.config.server).toBe("wss://sync.example.test");

    const again = findSettingInput(panelOf(tab), "Server address");
    again.value = "https://not-secure.example.test";
    again.dispatch("input");
    findButton(panelOf(tab), "Save and reconnect").click();
    await vi.waitFor(() => expect(panelOf(tab).textContent).toContain("Enter a secure WSS URL"));
    expect(plugin.config.server).toBe("wss://sync.example.test");
  });

  it("validates the staged draft before connecting and focuses the first invalid field", async () => {
    stubClipboard();
    const { plugin, tab } = await createPlugin();
    findButton(panelOf(tab), "Set up manually").click();
    const panel = panelOf(tab);
    const username = findSettingInput(panel, "Username");
    username.value = "user-test-a";
    username.dispatch("input");
    findButton(panel, "Save and reconnect").click();

    await vi.waitFor(() => expect(panel.textContent).toContain("Enter a secure WSS URL"));
    expect(ui.getFocused()).toBe(findSettingInput(panel, "Server address"));
    expect(plugin.config.server).toBe("");
    expect(connectVault).not.toHaveBeenCalled();
    expect(ui.notices).toEqual([]);
  });

  it("shows the bound vault ID read-only and saved secrets with Replace", async () => {
    stubClipboard();
    const { tab } = await createConfiguredPlugin({ s3: true });
    const panel = openServer(tab);

    expect(findSettingInput(panel, "Vault ID").disabled).toBe(true);
    expect(findSettingInput(panel, "Vault ID").value).toBe("VAULT_A");
    const password = findSetting(panel, "Password");
    expect(password.textContent).toContain("Saved in keychain");
    expect(password.querySelector("input")).toBeNull();
    expect(findSetting(panel, "Secret access key").textContent).toContain("Saved in keychain");
    expect(panel.textContent).not.toContain("stored-nats-password");

    findButton(password, "Replace…").click();
    const input = findSettingInput(panelOf(tab), "Password");
    expect(input.type).toBe("password");
    expect(ui.getFocused()).toBe(input);
    input.value = "new-password";
    input.dispatch("input");
    expect(byClass(panelOf(tab), "flash-sync-save-bar").textContent).toContain("1 unsaved change");
  });

  it("keeps dirty input across status refresh and supports keep and discard when leaving", async () => {
    stubClipboard();
    const { plugin, tab } = await createPlugin();
    const panel = openServer(tab);
    const server = findSettingInput(panel, "Server address");
    server.value = "wss://draft.example.test";
    server.dispatch("input");

    plugin.status.connectionState = "OFFLINE";
    plugin.status.refresh();
    expect(findSettingInput(panelOf(tab), "Server address").value).toBe("wss://draft.example.test");

    tabs(tab)[1].dispatch("keydown", { key: "ArrowRight" });
    await vi.waitFor(() => expect(ui.modals).toHaveLength(1));
    expect(ui.modals[0].contentEl.textContent).toContain("Server");
    findText(ui.modals[0].contentEl, "Keep editing").click();
    await vi.waitFor(() => expect(ui.getFocused()).toBe(tabs(tab)[1]));
    expect(panelOf(tab).id).toBe("flash-sync-panel-server");

    tabs(tab)[0].click();
    await vi.waitFor(() => expect(ui.modals).toHaveLength(2));
    findText(ui.modals[1].contentEl, "Discard").click();
    await vi.waitFor(() => expect(tabs(tab)[0].getAttribute("aria-selected")).toBe("true"));
    expect(plugin.config.server).toBe("");

    const reopened = openServer(tab);
    const draftServer = findSettingInput(reopened, "Server address");
    draftServer.value = "wss://discard-on-close.example.test";
    draftServer.dispatch("input");
    tab.hide();
    tab.display();
    expect(findSettingInput(openServer(tab), "Server address").value).toBe("");
  });

  it("stages attachment storage in the same draft and hides its fields while off", async () => {
    stubClipboard();
    const { plugin, tab } = await createConfiguredPlugin({ s3: true });
    const panel = openServer(tab);
    const toggle = descendants(byClass(panel, "flash-sync-attachments-head")).find((element) => element.tagName === "input")!;
    expect(toggle.checked).toBe(true);
    expect(findSettingInput(panel, "Endpoint").value).toBe("https://s3.example.test");

    toggle.checked = false;
    toggle.dispatch("change");
    expect(() => findSetting(panelOf(tab), "Endpoint")).toThrow();
    const bar = byClass(panelOf(tab), "flash-sync-save-bar");
    expect(bar.textContent).toContain("1 unsaved change");
    expect(bar.textContent).toContain("Attachment storage");

    findButton(bar, "Save and reconnect").click();
    await vi.waitFor(() => expect(plugin.config.s3Endpoint).toBe(""));
    expect(plugin.config.s3SecretKeySecretKey).toBe("");
    expect(plugin.config.server).toBe("wss://sync.example.test");
    expect(connectVault).toHaveBeenCalled();
  });

  it("validates attachment fields when storage is turned on", async () => {
    stubClipboard();
    const { plugin, tab } = await createConfiguredPlugin();
    const panel = openServer(tab);
    const toggle = descendants(byClass(panel, "flash-sync-attachments-head")).find((element) => element.tagName === "input")!;
    toggle.checked = true;
    toggle.dispatch("change");
    const endpoint = findSettingInput(panelOf(tab), "Endpoint");
    endpoint.value = "https://s3.example.test";
    endpoint.dispatch("input");
    expect(byClass(panelOf(tab), "flash-sync-save-bar").textContent).toContain("2 unsaved changes");

    findButton(panelOf(tab), "Save and reconnect").click();
    await vi.waitFor(() => expect(panelOf(tab).textContent).toContain("Bucket is required."));
    expect(ui.getFocused()).toBe(descendants(findSetting(panelOf(tab), "Bucket and region"))
      .find((element) => element.getAttribute("aria-label") === "Bucket"));
    expect(plugin.config.s3Endpoint).toBe("");
  });
});

describe("Advanced section", () => {
  function openAdvanced(tab: { containerEl: El }) {
    tabs(tab)[2].click();
    return panelOf(tab);
  }

  it("groups the inline limit, device ID and diagnostics without Save or Discard", async () => {
    stubClipboard();
    const { plugin, tab } = await createConfiguredPlugin();
    const panel = openAdvanced(tab);

    expect(findSetting(panel, "Inline note limit").textContent).toContain("Default: 512 KiB");
    expect(findSetting(panel, "Device ID")).toBeDefined();
    const diagnostics = byClass(panel, "flash-sync-diagnostics");
    expect(findSetting(diagnostics, "Debug logging")).toBeDefined();
    expect(findSetting(diagnostics, "Status report")).toBeDefined();
    expect(panel.textContent).not.toContain("Status bar");
    expect(hasButton(panel, "Save changes")).toBe(false);
    expect(hasButton(panel, "Discard")).toBe(false);

    const debug = descendants(findSetting(diagnostics, "Debug logging")).find((element) => element.getAttribute("type") === "checkbox")!;
    debug.checked = true;
    debug.dispatch("change");
    await vi.waitFor(() => expect(plugin.config.debugLogging).toBe(true));
  });

  it("copies the full device ID", async () => {
    const clipboard = stubClipboard();
    const { plugin, tab } = await createConfiguredPlugin();
    const row = findSetting(openAdvanced(tab), "Device ID");
    expect(row.textContent).toContain(plugin.config.deviceId.slice(0, 8));

    findButton(row, "Copy").click();
    await vi.waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith(plugin.config.deviceId));
    await vi.waitFor(() => expect(ui.notices.at(-1)).toBe("Device ID copied"));
  });

  it("copies a redacted status report", async () => {
    const clipboard = stubClipboard();
    const { plugin, tab } = await createConfiguredPlugin();
    plugin.status.connectionError = "Rejected at wss://user-test-a:stored-nats-password@sync.example.test/ws?token=hidden";
    plugin.status.lastError = "Rejected stored-nats-password";
    plugin.status.pending = 4;
    plugin.status.refresh();

    findButton(findSetting(openAdvanced(tab), "Status report"), "Copy report").click();
    await vi.waitFor(() => expect(clipboard.writeText).toHaveBeenCalled());
    const report = clipboard.writeText.mock.calls[0]![0] as string;
    expect(report).toContain("flash-sync status report");
    expect(report).toContain("Pending note changes: 4");
    expect(report).toContain("sync.example.test");
    expect(report).not.toContain("stored-nats-password");
    expect(report).not.toContain("hidden");
    expect(report).not.toContain("user-test-a");
    await vi.waitFor(() => expect(ui.notices.at(-1)).toBe("Status report copied"));
  });

  it("commits an inline limit once per changed value and keeps invalid values unsaved", async () => {
    stubClipboard();
    const { plugin, tab } = await createPlugin();
    const applyDraft = vi.spyOn(plugin, "applyDraft");
    const input = descendants(findSetting(openAdvanced(tab), "Inline note limit"))
      .find((element) => element.getAttribute("aria-label") === "Inline Markdown limit in KiB")!;

    input.value = "256";
    input.dispatch("change");
    input.dispatch("blur");
    await vi.waitFor(() => expect(plugin.config.inlineLimit).toBe(256 * 1024));
    expect(applyDraft).toHaveBeenCalledTimes(1);

    const invalid = descendants(findSetting(panelOf(tab), "Inline note limit"))
      .find((element) => element.getAttribute("aria-label") === "Inline Markdown limit in KiB")!;
    invalid.value = "0";
    invalid.dispatch("change");
    await vi.waitFor(() => expect(applyDraft).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(findSetting(panelOf(tab), "Inline note limit").textContent).toContain("positive whole number"));
    expect(plugin.config.inlineLimit).toBe(256 * 1024);
  });

  it("composes rapid control commits against the latest saved settings", async () => {
    stubClipboard();
    const { plugin, tab } = await createConfiguredPlugin();
    const minimal = descendants(byClass(panelOf(tab), "flash-sync-status-bar-row"))
      .find((element) => element.tagName === "input" && element.getAttribute("value") === "minimal")!;
    minimal.checked = true;
    minimal.dispatch("change");
    const debug = descendants(findSetting(openAdvanced(tab), "Debug logging"))
      .find((element) => element.getAttribute("type") === "checkbox")!;
    debug.checked = true;
    debug.dispatch("change");
    await vi.waitFor(() => expect(plugin.config).toMatchObject({ statusBarMode: "minimal", debugLogging: true }));
  });
});
