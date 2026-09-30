import { describe, expect, it, vi } from "vitest";
import { buildStatusReport, createLogger, errorSummary } from "../../packages/plugin/src/diagnostics.js";
import { SyncStatus, type KvPort } from "../../packages/plugin/src/connection.js";
import { MarkdownSyncEngine } from "../../packages/plugin/src/markdown-sync.js";
import { LocalStore } from "../../packages/plugin/src/local-store.js";
import { indexedDBDouble, NatsKvDouble, VaultDouble } from "../doubles/index.js";

describe("plugin diagnostics", () => {
  it("reports nested causes while omitting URL credentials", () => {
    const error = new Error("Reconciliation failed", {
      cause: new Error("Permission denied at wss://alice:secret@nats.example.test:443/path?token=hidden"),
    });
    const summary = errorSummary(error);
    expect(summary).toContain("Reconciliation failed");
    expect(summary).toContain("Permission denied");
    expect(summary).not.toContain("secret");
    expect(summary).not.toContain("hidden");
  });

  it("always logs errors and enables technical events only in debug mode", () => {
    const sink = { debug: vi.fn(), error: vi.fn() };
    let debug = false;
    const logger = createLogger(() => debug, sink);
    logger.debug("nats.connect", { bucket: "OBS_A_FILES" });
    expect(sink.debug).not.toHaveBeenCalled();
    logger.error("nats.connect", new Error("Authorization Violation"), { bucket: "OBS_A_FILES" });
    expect(sink.error).toHaveBeenCalledWith(expect.stringMatching(/^\[flash-sync\] \d{4}-\d{2}-\d{2}T.*Z nats\.connect: Authorization Violation$/), { bucket: "OBS_A_FILES" });
    debug = true;
    logger.debug("nats.connected", { bucket: "OBS_A_FILES" });
    expect(sink.debug).toHaveBeenCalledWith(expect.stringMatching(/^\[flash-sync\] \d{4}-\d{2}-\d{2}T.*Z nats\.connected$/), { bucket: "OBS_A_FILES" });
  });

  it("redacts active secret values from technical logs", () => {
    const sink = { debug: vi.fn(), error: vi.fn() };
    const logger = createLogger(() => false, sink, (message) => message.replaceAll("private-token", "[redacted]"));
    logger.error("connection.failed", new Error("Rejected private-token by server"));
    expect(sink.error).toHaveBeenCalledWith(expect.stringMatching(/^\[flash-sync\] \d{4}-\d{2}-\d{2}T.*Z connection\.failed: Rejected \[redacted\] by server$/), {});
  });

  it("keeps the root reconciliation failure visible in status and console", async () => {
    const sink = { debug: vi.fn(), error: vi.fn() };
    const logger = createLogger(() => true, sink);
    const store = await LocalStore.open(`diagnostics-${crypto.randomUUID()}`, indexedDBDouble.indexedDB);
    const status = new SyncStatus();
    const kv: KvPort = {
      get: () => null,
      list: () => [],
      put: () => 1,
      watch: () => { throw new Error("Permission Violation on $JS.API.CONSUMER.CREATE"); },
    };
    const engine = new MarkdownSyncEngine({ deviceId: "device-a", kv, store, vault: new VaultDouble(), status, logger });
    await expect(engine.start()).rejects.toThrow("Reconciliation failed");
    expect(status.lastError).toContain("Permission Violation on $JS.API.CONSUMER.CREATE");
    expect(sink.error).toHaveBeenCalledWith(
      expect.stringContaining("Permission Violation on $JS.API.CONSUMER.CREATE"),
      expect.objectContaining({ stage: "snapshot", discoveryMode: "legacy-list", snapshotComplete: false }),
    );
    engine.stop();
    store.close();
  });

  it("reports recovery after a failed reconciliation", async () => {
    const store = await LocalStore.open(`diagnostics-${crypto.randomUUID()}`, indexedDBDouble.indexedDB);
    const status = new SyncStatus();
    let available = false;
    const kv: KvPort = {
      get: () => null, list: () => [], put: () => 1,
      watch: () => {
        if (!available) throw new Error("NATS unavailable");
        return () => {};
      },
    };
    const engine = new MarkdownSyncEngine({ deviceId: "device-a", kv, store, vault: new VaultDouble(), status });
    await expect(engine.start()).rejects.toThrow("Reconciliation failed");
    expect(status.connected).toBe(false);
    available = true;
    await engine.reconcile();
    expect(status.value).toBe("SYNCED");
    engine.stop();
    store.close();
  });

  it("logs a background vault read failure without an unhandled rejection", async () => {
    const sink = { debug: vi.fn(), error: vi.fn() };
    const logger = createLogger(() => false, sink);
    const store = await LocalStore.open(`diagnostics-${crypto.randomUUID()}`, indexedDBDouble.indexedDB);
    const vault = new VaultDouble();
    const status = new SyncStatus();
    const engine = new MarkdownSyncEngine({ deviceId: "device-a", kv: new NatsKvDouble(), store, vault, status, logger });
    await engine.start();
    vault.read = () => { throw new Error("read failed"); };
    vault.write("note.md", new TextEncoder().encode("content"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(status.lastError).toBe("read failed");
    expect(sink.error).toHaveBeenCalledWith(expect.stringMatching(/^\[flash-sync\] \d{4}-\d{2}-\d{2}T.*Z vault\.read_failed: read failed$/), {});
    engine.stop();
    store.close();
  });

  it("builds a status report with states and counts but never secrets or URL credentials", () => {
    const status = new SyncStatus();
    status.connectionState = "AUTH_ERROR";
    status.value = "AUTH_ERROR";
    status.pending = 3;
    status.blobsPending = 1;
    status.conflicts = 2;
    status.attachmentState = "CONFIGURED";
    status.lastReconciledAt = Date.UTC(2026, 8, 30, 12, 0, 0);
    status.connectionError = "Authorization Violation at wss://alice:hunter2@sync.example.test:8443/ws?token=hidden";
    status.lastError = "Rejected stored-password-value while importing obsidian://flash-sync-import?data=2.eyJ2YXVsdElkIjoiQSJ9 " +
      "code 1.QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5eg";
    const report = buildStatusReport(status, {
      vaultId: "VAULT_A", server: "wss://alice:hunter2@sync.example.test:8443/ws?token=hidden", debugLogging: false,
      inlineLimit: 524288, statusBarMode: "extended",
    }, { pluginVersion: "0.2.1", platform: "desktop", now: new Date(Date.UTC(2026, 8, 30, 12, 5, 0)),
      redact: (message) => message.replaceAll("stored-password-value", "[redacted]") });

    expect(report).toContain("flash-sync status report");
    expect(report).toContain("Plugin version: 0.2.1");
    expect(report).toContain("Sync server: AUTH_ERROR (sync.example.test:8443)");
    expect(report).toContain("Pending note changes: 3");
    expect(report).toContain("Pending attachment transfers: 1");
    expect(report).toContain("Conflicts: 2");
    expect(report).toContain("Last reconciled: 2026-09-30T12:00:00.000Z");
    expect(report).toContain("Authorization Violation");
    for (const secret of ["alice", "hunter2", "hidden", "stored-password-value", "eyJ2YXVsdElkIjoiQSJ9", "QUJDREVGR0hJSktM"]) {
      expect(report).not.toContain(secret);
    }
  });

  it("reports an empty error list and unknown reconciliation time explicitly", () => {
    const report = buildStatusReport(new SyncStatus(), { vaultId: "VAULT_A", server: "", debugLogging: true,
      inlineLimit: 524288, statusBarMode: "minimal" }, { pluginVersion: "0.2.1", platform: "mobile" });
    expect(report).toContain("Sync server: UNCONFIGURED (not set)");
    expect(report).toContain("Last reconciled: never");
    expect(report).toContain("Recent errors: none");
    expect(report).toContain("Platform: mobile");
  });
});
