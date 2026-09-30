import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SyncStatus } from "../../packages/plugin/src/connection.js";
import { LocalStore } from "../../packages/plugin/src/local-store.js";
import { MarkdownSyncEngine } from "../../packages/plugin/src/markdown-sync.js";
import { indexedDBDouble, NatsKvDouble, VaultDouble } from "../doubles/index.js";

describe("last reconciliation time", () => {
  it("is set only when reconciliation completes with no pending work", () => {
    const status = new SyncStatus();
    expect(status.lastReconciledAt).toBe(0);

    status.pending = 2;
    status.markReconciled(1_000);
    expect(status.reconciled).toBe(true);
    expect(status.lastReconciledAt).toBe(0);

    status.pending = 0;
    status.blobsPending = 1;
    status.markReconciled(2_000);
    expect(status.lastReconciledAt).toBe(0);

    status.blobsPending = 0;
    status.markReconciled(3_000);
    expect(status.lastReconciledAt).toBe(3_000);

    status.pending = 1;
    status.markReconciled(4_000);
    expect(status.lastReconciledAt).toBe(3_000);
  });

  it("is recorded by the engine when a reconciliation finishes cleanly", async () => {
    const kv = new NatsKvDouble();
    const vault = new VaultDouble();
    vault.write("note.md", new TextEncoder().encode("body"));
    const store = await LocalStore.open(`status-${crypto.randomUUID()}`, indexedDBDouble.indexedDB);
    const status = new SyncStatus();
    const engine = new MarkdownSyncEngine({ deviceId: "device", vault, store, kv, status, debounceMs: 0 });
    const before = Date.now();

    await engine.start();

    expect(status.pending).toBe(0);
    expect(status.lastReconciledAt).toBeGreaterThanOrEqual(before);
    engine.stop(); await engine.settle(); store.close();
  });

  it("is display-only and never read by sync ordering code", () => {
    for (const file of ["markdown-sync.ts", "local-store.ts", "conflict-resolution.ts"]) {
      const source = readFileSync(new URL(`../../packages/plugin/src/${file}`, import.meta.url), "utf8");
      expect(source, file).not.toMatch(/lastReconciledAt/);
    }
  });
});
