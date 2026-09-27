import { afterEach, describe, expect, it, vi } from "vitest";
import { TFile } from "../doubles/obsidian.js";
import { indexedDBDouble, NatsKvDouble } from "../doubles/index.js";

const connectVault = vi.hoisted(() => vi.fn());

vi.mock("../../packages/plugin/src/connection.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../packages/plugin/src/connection.js")>();
  return { ...actual, connectVault };
});

import EasySyncPlugin from "../../packages/plugin/src/main.js";

type PluginFile = TFile & { path: string };
type FileEvent = (file: TFile, oldPath?: string) => void;

class VaultFile extends TFile {
  constructor(public path: string) { super(); }
}

class ObsidianVaultDouble {
  readonly files = new Map<string, PluginFile>();
  readonly data = new Map<string, Uint8Array>();
  readonly folders = new Set<string>();
  private readonly listeners = new Map<object, { event: string; listener: FileEvent }>();

  getAbstractFileByPath(path: string): PluginFile | { path: string } | null {
    return this.files.get(path) ?? (this.folders.has(path) ? { path } : null);
  }

  getFiles(): PluginFile[] { return [...this.files.values()]; }
  getMarkdownFiles(): PluginFile[] { return this.getFiles().filter((file) => file.path.endsWith(".md")); }
  async readBinary(file: TFile): Promise<ArrayBuffer> { return this.data.get((file as PluginFile).path)!.slice().buffer; }
  async read(file: TFile): Promise<string> { return new TextDecoder().decode(await this.readBinary(file)); }

  async createFolder(path: string): Promise<void> { this.folders.add(path); }
  async create(path: string, content: string): Promise<PluginFile> {
    return this.add(path, new TextEncoder().encode(content), "create");
  }
  async createBinary(path: string, content: ArrayBuffer): Promise<PluginFile> {
    return this.add(path, new Uint8Array(content), "create");
  }
  async modify(file: TFile, content: string): Promise<void> {
    this.data.set((file as PluginFile).path, new TextEncoder().encode(content));
    this.emit("modify", file);
  }
  async modifyBinary(file: TFile, content: ArrayBuffer): Promise<void> {
    this.data.set((file as PluginFile).path, new Uint8Array(content));
    this.emit("modify", file);
  }
  async trash(file: TFile): Promise<void> {
    const item = file as PluginFile;
    this.files.delete(item.path);
    this.data.delete(item.path);
    this.emit("delete", item);
  }
  async renameFile(file: TFile, path: string): Promise<void> {
    const item = file as PluginFile;
    const oldPath = item.path;
    this.files.delete(oldPath);
    this.data.set(path, this.data.get(oldPath)!);
    this.data.delete(oldPath);
    item.path = path;
    this.files.set(path, item);
    this.emit("rename", item, oldPath);
  }
  on(event: string, listener: FileEvent): object {
    const reference = {};
    this.listeners.set(reference, { event, listener });
    return reference;
  }
  offref(reference: object): void { this.listeners.delete(reference); }
  emit(event: string, file: TFile, oldPath?: string): void {
    for (const entry of this.listeners.values()) if (entry.event === event) entry.listener(file, oldPath);
  }

  private async add(path: string, bytes: Uint8Array, event: string): Promise<PluginFile> {
    const file = new VaultFile(path);
    this.files.set(path, file);
    this.data.set(path, bytes.slice());
    this.emit(event, file);
    return file;
  }
}

function pluginSettings(plugin: EasySyncPlugin): void {
  plugin.config = { vaultId: "VAULT_A", boundVaultId: "", deviceId: "device-a", server: "wss://nats.example.test",
    username: "alice", passwordSecretKey: "nats-password", s3Endpoint: "", s3Bucket: "", s3Region: "us-east-1",
    s3AccessKeyId: "", s3SecretKeySecretKey: "", inlineLimit: 262144, debugLogging: false, statusBarMode: "extended" };
}

async function connectedPlugin(vault: ObsidianVaultDouble) {
  const kv = new NatsKvDouble();
  const secrets = new Map([["nats-password", "secret"]]);
  const app = { vault, fileManager: { renameFile: (file: TFile, path: string) => vault.renameFile(file, path) },
    secretStorage: { getSecret: (key: string) => secrets.get(key) ?? null } };
  const plugin = new EasySyncPlugin(app as never, {} as never);
  pluginSettings(plugin);
  vi.stubGlobal("indexedDB", indexedDBDouble.indexedDB);
  connectVault.mockResolvedValueOnce(kv);
  await expect(plugin.connectNow()).resolves.toEqual({ kind: "applied" });
  const runtime = plugin as unknown as { engine: { options: { vault: Adapter }; stop(): void }; onunload(): Promise<void> };
  runtime.engine.stop();
  return { adapter: runtime.engine.options.vault, close: () => runtime.onunload() };
}

type Adapter = {
  read(path: string): Promise<Uint8Array | undefined>;
  listMarkdown(): Promise<Array<{ path: string; content: string }>>;
  listFiles(): Promise<Array<{ path: string; bytes: Uint8Array }>>;
  write(path: string, bytes: Uint8Array): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  onModify(listener: (path: string) => void): () => void;
  onRename(listener: (from: string, to: string) => void): () => void;
  onDelete(listener: (path: string) => void): () => void;
};

afterEach(() => {
  connectVault.mockReset();
  vi.unstubAllGlobals();
});

describe("Obsidian MarkdownVault adapter", () => {
  it("reads and lists included files, creates folders, writes, renames, and removes", async () => {
    const appVault = new ObsidianVaultDouble();
    await appVault.create("notes/one.md", "one");
    await appVault.createBinary("images/one.png", new Uint8Array([1, 2]).buffer);
    await appVault.create(".obsidian/settings.md", "private");
    await appVault.create("Flash Sync Conflict Reviews/review.md", "private");
    const runtime = await connectedPlugin(appVault);
    try {
      expect(new TextDecoder().decode(await runtime.adapter.read("images/one.png"))).toBe("\u0001\u0002");
      expect(await runtime.adapter.read("notes/missing.md")).toBeUndefined();
      expect((await runtime.adapter.listMarkdown()).map((entry) => entry.path)).toEqual(["notes/one.md"]);
      expect((await runtime.adapter.listFiles()).map((entry) => entry.path)).toEqual(["notes/one.md", "images/one.png"]);

      await runtime.adapter.write("nested/deeper/new.md", new TextEncoder().encode("created"));
      expect(appVault.folders.has("nested")).toBe(true);
      expect(appVault.folders.has("nested/deeper")).toBe(true);
      await runtime.adapter.write("nested/deeper/new.md", new TextEncoder().encode("updated"));
      expect(new TextDecoder().decode(await runtime.adapter.read("nested/deeper/new.md"))).toBe("updated");
      await runtime.adapter.write("nested/deeper/image.bin", new Uint8Array([5, 6]));
      expect([...(await runtime.adapter.read("nested/deeper/image.bin"))!]).toEqual([5, 6]);

      await runtime.adapter.rename("nested/deeper/new.md", "other/place/renamed.md");
      expect(await runtime.adapter.read("nested/deeper/new.md")).toBeUndefined();
      expect(new TextDecoder().decode(await runtime.adapter.read("other/place/renamed.md"))).toBe("updated");
      await runtime.adapter.remove("other/place/renamed.md");
      expect(await runtime.adapter.read("other/place/renamed.md")).toBeUndefined();
    } finally {
      await runtime.close();
    }
  });

  it("filters vault events and unregisters modify, rename, and delete handlers", async () => {
    const appVault = new ObsidianVaultDouble();
    const runtime = await connectedPlugin(appVault);
    try {
      const modified: string[] = [];
      const renamed: Array<[string, string]> = [];
      const deleted: string[] = [];
      const stopModify = runtime.adapter.onModify((path) => modified.push(path));
      const stopRename = runtime.adapter.onRename((from, to) => renamed.push([from, to]));
      const stopDelete = runtime.adapter.onDelete((path) => deleted.push(path));
      const included = await appVault.create("notes/allowed.md", "start");
      appVault.emit("modify", included);
      const excluded = await appVault.create(".obsidian/ignored.md", "private");
      appVault.emit("modify", excluded);
      appVault.emit("modify", { path: "notes/not-a-file.md" } as TFile);
      appVault.emit("rename", included, ".obsidian/ignored.md");
      appVault.emit("rename", included, "notes/old.md");
      appVault.emit("delete", included);
      appVault.emit("delete", { path: ".obsidian/ignored.md" } as TFile);

      expect(modified).toEqual(["notes/allowed.md", "notes/allowed.md"]);
      expect(renamed).toEqual([["notes/old.md", "notes/allowed.md"]]);
      expect(deleted).toEqual(["notes/allowed.md"]);
      stopModify(); stopRename(); stopDelete();
      appVault.emit("modify", included);
      appVault.emit("rename", included, "notes/old.md");
      appVault.emit("delete", included);
      expect(modified).toHaveLength(2);
      expect(renamed).toHaveLength(1);
      expect(deleted).toHaveLength(1);
    } finally {
      await runtime.close();
    }
  });
});
