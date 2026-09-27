import { describe, expect, it } from "vitest";
import { encodePathOwnershipRecord, encodeRecord, pathOwnershipKey, sha256Hex, type RemoteFileRecord } from "../../packages/protocol/src/index.js";
import { SyncStatus } from "../../packages/plugin/src/connection.js";
import { LocalStore } from "../../packages/plugin/src/local-store.js";
import { MarkdownSyncEngine } from "../../packages/plugin/src/markdown-sync.js";
import { indexedDBDouble, NatsKvDouble, VaultDouble } from "../doubles/index.js";

const bytes = (value: string) => new TextEncoder().encode(value);
const text = (vault: VaultDouble, path: string) => {
  const value = vault.read(path);
  return value && new TextDecoder().decode(value);
};
const remote = (fileId: string, path: string, content: string): RemoteFileRecord => ({
  schemaVersion: 1, fileId, path, kind: "text", deleted: false,
  contentHash: sha256Hex(bytes(content)), size: bytes(content).length, content,
  origin: { deviceId: "other-device", operationId: `op-${fileId}`, clientTime: 1 },
});
async function setup(localFiles: Record<string, string>, remoteFiles: RemoteFileRecord[], blob?: { upload(key: string, bytes: Uint8Array): Promise<void>; download(key: string): Promise<Uint8Array> }) {
  const kv = new NatsKvDouble();
  const vault = new VaultDouble();
  for (const [path, value] of Object.entries(localFiles)) vault.write(path, bytes(value));
  for (const value of remoteFiles) {
    kv.create(`f.${value.fileId}`, encodeRecord(value));
    const canonicalPath = value.path.toLowerCase();
    kv.create(pathOwnershipKey(value.path), encodePathOwnershipRecord({ schemaVersion: 1, canonicalPath,
      fileId: value.fileId, operationId: value.origin.operationId, state: "owned" }));
  }
  const store = await LocalStore.open(`bootstrap-${crypto.randomUUID()}`, indexedDBDouble.indexedDB);
  const status = new SyncStatus();
  const engine = new MarkdownSyncEngine({ deviceId: "local-device", kv, vault, store, status, blob });
  return { kv, vault, store, status, engine };
}

describe("conservative bootstrap", () => {
  it("publishes first device files once and keeps stable IDs on retry", async () => {
    const state = await setup({ "first.md": "first", "folder/second.md": "second" }, []);
    await state.engine.start();
    const first = await state.store.getFileByPath("first.md");
    expect(first?.fileId).toBeTruthy();
    expect(state.kv.list().filter(({ key }) => key.startsWith("f."))).toHaveLength(2);
    await state.engine.reconcile();
    expect(state.kv.list().filter(({ key }) => key.startsWith("f."))).toHaveLength(2);
    expect((await state.store.getFileByPath("first.md"))?.fileId).toBe(first?.fileId);
    state.engine.stop(); state.store.close();
  });

  it("downloads into empty local vault without publishing an echo", async () => {
    const state = await setup({}, [remote("remote-a", "folder/note.md", "remote")]);
    await state.engine.start();
    expect(text(state.vault, "folder/note.md")).toBe("remote");
    expect((await state.store.getFileByPath("folder/note.md"))?.fileId).toBe("remote-a");
    expect(await state.store.pending()).toEqual([]);
    state.engine.stop(); state.store.close();
  });

  it("binds equal files, publishes local-only files, downloads remote-only files", async () => {
    const state = await setup({ "same.md": "equal", "local.md": "local" }, [
      remote("remote-a", "same.md", "equal"), remote("remote-b", "remote.md", "remote"),
    ]);
    await state.engine.start();
    expect((await state.store.getFileByPath("same.md"))?.fileId).toBe("remote-a");
    expect(state.kv.list().filter(({ key }) => key.startsWith("f."))).toHaveLength(3);
    expect(text(state.vault, "remote.md")).toBe("remote");
    state.engine.stop(); state.store.close();
  });

  it("preserves different local content as one conflict copy on repeated bootstrap", async () => {
    const state = await setup({ "same.md": "local" }, [remote("remote-a", "same.md", "remote")]);
    await state.engine.start();
    expect(text(state.vault, "same.md")).toBe("remote");
    const conflictPath = "same.conflict-local-device-remote-a.md";
    expect(text(state.vault, conflictPath)).toBe("local");
    await state.engine.reconcile();
    expect(state.vault.files.size).toBe(2);
    expect(text(state.vault, conflictPath)).toBe("local");
    state.engine.stop(); state.store.close();
  });

  it("keeps an occupied binary bootstrap copy untouched when its bytes differ", async () => {
    const local = new Uint8Array([1, 2, 3]);
    const incoming = new Uint8Array([4, 5, 6]);
    const blobKey = "vaults/VAULT/blobs/asset";
    const record: RemoteFileRecord = { schemaVersion: 1, fileId: "remote-blob", path: "images/photo.png", kind: "blob",
      deleted: false, contentHash: sha256Hex(incoming), size: incoming.length,
      blob: { algorithm: "sha256", hash: sha256Hex(incoming), key: blobKey, size: incoming.length },
      origin: { deviceId: "other-device", operationId: "blob-create", clientTime: 1 } };
    let downloads = 0;
    const state = await setup({}, [record], { upload: async () => {}, download: async () => { downloads++; return incoming; } });
    const copyPath = "images/photo.conflict-remote-blob.png";
    state.vault.write("images/photo.png", local);
    state.vault.write(copyPath, new Uint8Array([9, 8, 7]));
    state.vault.events.length = 0;

    await state.engine.start();

    expect([...state.vault.read("images/photo.png")!]).toEqual([...local]);
    expect([...state.vault.read(copyPath)!]).toEqual([9, 8, 7]);
    expect(await state.store.getFile("remote-blob")).toBeUndefined();
    expect(downloads).toBe(0);
    expect(state.vault.events).toEqual([]);
    state.engine.stop(); state.store.close();
  });

  it("records a binary bootstrap conflict without rewriting an identical existing copy", async () => {
    const local = new Uint8Array([1, 2, 3]);
    const incoming = new Uint8Array([4, 5, 6]);
    const record: RemoteFileRecord = { schemaVersion: 1, fileId: "remote-blob", path: "images/photo.png", kind: "blob",
      deleted: false, contentHash: sha256Hex(incoming), size: incoming.length,
      blob: { algorithm: "sha256", hash: sha256Hex(incoming), key: "vaults/VAULT/blobs/asset", size: incoming.length },
      origin: { deviceId: "other-device", operationId: "blob-create", clientTime: 1 } };
    const state = await setup({}, [record], { upload: async () => {}, download: async () => incoming });
    const copyPath = "images/photo.conflict-remote-blob.png";
    state.vault.write("images/photo.png", local);
    state.vault.write(copyPath, local);
    state.vault.events.length = 0;

    await state.engine.start();

    expect([...state.vault.read("images/photo.png")!]).toEqual([...incoming]);
    expect([...state.vault.read(copyPath)!]).toEqual([...local]);
    expect((await state.store.getFile("remote-blob"))?.remoteRevision).toBeGreaterThan(0);
    expect(state.vault.events.filter((event) => event.type === "modify")).toEqual([{ type: "modify", path: "images/photo.png" }]);
    expect((await state.store.conflicts()).map((conflict) => conflict.copyPath)).toEqual([copyPath]);
    state.engine.stop(); state.store.close();
  });
});
