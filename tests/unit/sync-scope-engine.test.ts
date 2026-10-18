import { describe, expect, it } from "vitest";
import { decodeRecord, encodeRecord, sha256Hex } from "../../packages/protocol/src/index.js";
import { MarkdownSyncEngine } from "../../packages/plugin/src/markdown-sync.js";
import { LocalStore } from "../../packages/plugin/src/local-store.js";
import { SyncStatus } from "../../packages/plugin/src/connection.js";
import { compileScope } from "../../packages/plugin/src/sync-scope.js";
import { indexedDBDouble, NatsKvDouble, VaultDouble } from "../doubles/index.js";

const enc = (value: string) => new TextEncoder().encode(value);
const scopeOf = (patterns: string) => compileScope({ mode: "exclude", patterns, skipJunk: true }).isInScope;

async function replica(deviceId: string, kv: NatsKvDouble, patterns = "", vault = new VaultDouble()) {
  const store = await LocalStore.open(`state-${crypto.randomUUID()}`, indexedDBDouble.indexedDB);
  const status = new SyncStatus();
  const engine = new MarkdownSyncEngine({ deviceId, vault, store, kv, status, debounceMs: 5, isInScope: scopeOf(patterns) });
  await engine.start();
  return { vault, store, status, engine };
}

const remoteRecords = (kv: NatsKvDouble) => kv.list().filter((entry) => entry.key.startsWith("f.")).map((entry) => decodeRecord(entry.value));

describe("sync scope in the engine", () => {
  it("does not capture, queue or upload out-of-scope files", async () => {
    const kv = new NatsKvDouble();
    const a = await replica("device-a", kv, "code/");
    await a.engine.capture("code/main.md", "print()");
    await a.engine.capture("scripts/venv/lib/x.md", "junk");
    await a.engine.capture("notes/a.md", "hello");
    await a.engine.settle();
    expect(remoteRecords(kv).map((record) => record.path)).toEqual(["notes/a.md"]);
    expect(await a.store.pending()).toEqual([]);
    a.engine.stop(); a.store.close();
  });

  it("keeps a synced file untouched without a tombstone when it becomes excluded", async () => {
    const kv = new NatsKvDouble();
    const a = await replica("device-a", kv);
    await a.engine.capture("code/a.md", "v1");
    await a.engine.settle();
    await a.engine.updateScope(scopeOf("code/"));
    await a.engine.capture("code/a.md", "v2");
    a.vault.delete("code/a.md");
    await a.engine.remove("code/a.md");
    await a.engine.settle();
    const records = remoteRecords(kv);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ path: "code/a.md", deleted: false, content: "v1" });
    expect(await a.store.pending()).toEqual([]);
    a.engine.stop(); a.store.close();
  });

  it("does not write out-of-scope remote records locally and leaves them in KV", async () => {
    const kv = new NatsKvDouble();
    const a = await replica("device-a", kv);
    await a.engine.capture("build/x.md", "remote junk");
    await a.engine.capture("notes/n.md", "note");
    await a.engine.settle();
    const b = await replica("device-b", kv, "build/");
    const c = await replica("device-c", kv, "notes/");
    expect(b.vault.read("build/x.md")).toBeUndefined();
    expect(c.vault.read("notes/n.md")).toBeUndefined();
    expect(b.vault.read("notes/n.md")).toBeDefined();
    expect(remoteRecords(kv)).toHaveLength(2);
    for (const r of [a, b, c]) { r.engine.stop(); r.store.close(); }
  });

  it("applies a remote record once its path re-enters scope", async () => {
    const kv = new NatsKvDouble();
    const a = await replica("device-a", kv);
    await a.engine.capture("code/a.md", "v1");
    await a.engine.settle();
    const b = await replica("device-b", kv, "code/");
    expect(b.vault.read("code/a.md")).toBeUndefined();
    await b.engine.updateScope(scopeOf(""));
    expect(new TextDecoder().decode(b.vault.read("code/a.md"))).toBe("v1");
    for (const r of [a, b]) { r.engine.stop(); r.store.close(); }
  });

  it("holds queued work for a path that leaves scope and resumes it afterwards", async () => {
    const kv = new NatsKvDouble();
    const a = await replica("device-a", kv);
    await a.engine.capture("code/a.md", "v1");
    await a.engine.settle();
    const create = kv.update.bind(kv);
    kv.update = () => { throw new Error("NATS offline"); };
    await a.engine.capture("code/a.md", "v2 offline");
    expect((await a.store.pending()).map((item) => item.content)).toEqual(["v2 offline"]);
    kv.update = create;
    await a.engine.updateScope(scopeOf("code/"));
    await a.engine.settle();
    expect((await a.store.pending()).map((item) => item.content)).toEqual(["v2 offline"]);
    expect(a.status.held).toBe(1);
    expect(a.status.pending).toBe(0);
    expect(remoteRecords(kv)[0]).toMatchObject({ content: "v1" });
    await a.engine.updateScope(scopeOf(""));
    await a.engine.settle();
    expect(await a.store.pending()).toEqual([]);
    expect(a.status.held).toBe(0);
    expect(remoteRecords(kv)[0]).toMatchObject({ content: "v2 offline" });
    a.engine.stop(); a.store.close();
  });

  it("treats renames across the boundary as delete or create", async () => {
    const kv = new NatsKvDouble();
    const a = await replica("device-a", kv, "code/");
    await a.engine.capture("notes/a.md", "keep me");
    await a.engine.settle();
    const original = (await a.store.getFileByPath("notes/a.md"))!;
    a.vault.rename("notes/a.md", "code/a.md");
    await a.engine.rename("notes/a.md", "code/a.md");
    await a.engine.settle();
    expect(remoteRecords(kv).find((record) => record.fileId === original.fileId)).toMatchObject({ deleted: true });

    a.vault.write("code/b.md", enc("moves in"));
    a.vault.rename("code/b.md", "notes/b.md");
    await a.engine.rename("code/b.md", "notes/b.md");
    await a.engine.settle();
    const created = remoteRecords(kv).find((record) => record.path === "notes/b.md")!;
    expect(created).toMatchObject({ deleted: false, content: "moves in" });
    expect(created.fileId).not.toBe(original.fileId);
    a.engine.stop(); a.store.close();
  });

  it("ignores a remote tombstone for an out-of-scope path", async () => {
    const kv = new NatsKvDouble();
    const a = await replica("device-a", kv);
    await a.engine.capture("code/a.md", "v1");
    await a.engine.settle();
    const b = await replica("device-b", kv, "code/");
    b.vault.write("code/a.md", enc("local copy"));
    const entry = kv.list().find((item) => item.key.startsWith("f."))!;
    const record = decodeRecord(entry.value);
    const bytes = enc("");
    kv.update(entry.key, encodeRecord({ ...record, deleted: true, content: undefined, size: 0, contentHash: sha256Hex(bytes) }), entry.revision);
    await b.engine.reconcile();
    expect(new TextDecoder().decode(b.vault.read("code/a.md"))).toBe("local copy");
    for (const r of [a, b]) { r.engine.stop(); r.store.close(); }
  });
});
