import { afterEach, describe, expect, it, vi } from "vitest";
import EasySyncPlugin from "../../packages/plugin/src/main.js";
import { Plugin, pluginInstances } from "../doubles/obsidian.js";

const harness = vi.hoisted(() => ({
  engineCreated: 0,
  engineStarted: 0,
  engineStopped: 0,
  storeOpened: 0,
  outbox: ["pending-operation"],
  localFiles: new Map([["note.md", "local content"]]),
}));
const connectVault = vi.hoisted(() => vi.fn());

vi.mock("obsidian", async (importOriginal) => {
  const actual = await importOriginal<typeof import("obsidian")>();
  return { ...actual, Platform: { isMobile: false }, setIcon: () => {} };
});

vi.mock("../../packages/plugin/src/connection.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../packages/plugin/src/connection.js")>();
  return { ...actual, connectVault };
});

vi.mock("../../packages/plugin/src/local-store.js", () => ({
  LocalStore: {
    open: vi.fn(async () => {
      harness.storeOpened++;
      return { close: vi.fn() };
    }),
  },
}));

vi.mock("../../packages/plugin/src/markdown-sync.js", () => ({
  MarkdownSyncEngine: class {
    constructor() { harness.engineCreated++; }
    async start() { harness.engineStarted++; }
    stop() { harness.engineStopped++; }
    async settle() {}
    async reconcile() {}
  },
}));

function statusBarFixture(): HTMLElement {
  const item = {
    style: { color: "" },
    tabIndex: 0,
    classList: { add: () => {}, remove: () => {} },
    empty: () => {},
    setAttribute: () => {},
    addEventListener: () => {},
    createSpan: () => item,
  };
  return item as unknown as HTMLElement;
}

async function createLifecycle(settingsOverrides: Record<string, unknown> = {}) {
  let ready: (() => void) | undefined;
  const handlers = new Map<string, () => void>();
  const secrets = new Map([["password-key", "stored-password"]]);
  const workspace = {
    onLayoutReady: vi.fn((callback: () => void) => { ready = callback; }),
    getActiveViewOfType: vi.fn(),
  };
  const app = {
    workspace,
    secretStorage: {
      getSecret: vi.fn((key: string) => secrets.get(key) ?? null),
      setSecret: vi.fn((key: string, value: string) => { secrets.set(key, value); }),
      deleteSecret: vi.fn((key: string) => { secrets.delete(key); }),
    },
  };
  vi.stubGlobal("document", { hidden: false });
  vi.stubGlobal("window", {});
  vi.spyOn(Plugin.prototype, "addStatusBarItem").mockReturnValue(statusBarFixture() as never);
  const plugin = new EasySyncPlugin(app as never, {} as never);
  const obsidianInstance = pluginInstances.at(-1)!;
  obsidianInstance.savedData = {
    vaultId: "VAULT_A", boundVaultId: "", deviceId: "device-a", server: "wss://sync.example.test",
    username: "vault-user", passwordSecretKey: "password-key", s3Endpoint: "", s3Bucket: "",
    s3Region: "us-east-1", s3AccessKeyId: "", s3SecretKeySecretKey: "", inlineLimit: 262144,
    debugLogging: false, statusBarMode: "extended", ...settingsOverrides,
  };
  (plugin as unknown as { registerDomEvent: (target: unknown, event: string, callback: () => void) => void })
    .registerDomEvent = (_target, event, callback) => { handlers.set(event, callback); };
  await plugin.onload();

  return {
    plugin,
    correctCredentials: () => secrets.set("password-key", "corrected-password"),
    ready: () => ready?.(),
    online: () => handlers.get("online")?.(),
    resume: () => handlers.get("visibilitychange")?.(),
  };
}

afterEach(() => {
  connectVault.mockReset();
  harness.engineCreated = 0;
  harness.engineStarted = 0;
  harness.engineStopped = 0;
  harness.storeOpened = 0;
  harness.outbox = ["pending-operation"];
  harness.localFiles = new Map([["note.md", "local content"]]);
  pluginInstances.length = 0;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("automatic startup connection lifecycle", () => {
  it("recovers from a transient initial failure when connectivity returns", async () => {
    connectVault.mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValueOnce({ close: vi.fn() });
    const lifecycle = await createLifecycle();

    lifecycle.ready();
    await vi.waitFor(() => expect(connectVault).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(lifecycle.plugin.status.connectionState).toBe("OFFLINE"));
    lifecycle.online();

    await vi.waitFor(() => expect(connectVault).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(harness.engineStarted).toBe(1));
    expect(harness.engineCreated).toBe(1);
    await lifecycle.plugin.onunload();
  });

  it("stops automatic attempts after authentication failure and leaves durable work untouched", async () => {
    connectVault.mockImplementationOnce(async (...args: unknown[]) => {
      const status = args[3] as { value: string; connectionState: string };
      status.value = "AUTH_ERROR";
      status.connectionState = "AUTH_ERROR";
      throw new Error("Authorization Violation");
    });
    const lifecycle = await createLifecycle();

    lifecycle.ready();
    await vi.waitFor(() => expect(connectVault).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(lifecycle.plugin.status.connectionState).toBe("AUTH_ERROR"));
    lifecycle.online();
    lifecycle.resume();

    expect(connectVault).toHaveBeenCalledTimes(1);
    expect(harness.storeOpened).toBe(0);
    expect(harness.engineCreated).toBe(0);
    expect(harness.outbox).toEqual(["pending-operation"]);
    expect([...harness.localFiles]).toEqual([["note.md", "local content"]]);
    await lifecycle.plugin.onunload();
  });

  it("allows manual Connect after an authentication failure", async () => {
    connectVault.mockImplementationOnce(async (...args: unknown[]) => {
      const secrets = args[1] as { getSecret(key: string): Promise<string | null> };
      expect(await secrets.getSecret("password-key")).toBe("stored-password");
      const status = args[3] as { value: string; connectionState: string };
      status.value = "AUTH_ERROR";
      status.connectionState = "AUTH_ERROR";
      throw new Error("Authorization Violation");
    }).mockImplementationOnce(async (...args: unknown[]) => {
      const secrets = args[1] as { getSecret(key: string): Promise<string | null> };
      expect(await secrets.getSecret("password-key")).toBe("corrected-password");
      return { close: vi.fn() };
    });
    const lifecycle = await createLifecycle();

    lifecycle.ready();
    await vi.waitFor(() => expect(connectVault).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(lifecycle.plugin.status.connectionState).toBe("AUTH_ERROR"));
    lifecycle.correctCredentials();
    await lifecycle.plugin.connectNow();

    expect(connectVault).toHaveBeenCalledTimes(2);
    expect(harness.engineCreated).toBe(1);
    expect(harness.engineStarted).toBe(1);
    expect(harness.outbox).toEqual(["pending-operation"]);
    expect([...harness.localFiles]).toEqual([["note.md", "local content"]]);
    await lifecycle.plugin.onunload();
  });

  it("does not retry invalid connection configuration on online or resume signals", async () => {
    const lifecycle = await createLifecycle({ server: "https://insecure.example.test" });

    lifecycle.ready();
    await vi.waitFor(() => expect(lifecycle.plugin.status.connectionState).toBe("OFFLINE"));
    lifecycle.online();
    lifecycle.resume();

    expect(connectVault).not.toHaveBeenCalled();
    expect(harness.engineCreated).toBe(0);
    await lifecycle.plugin.onunload();
  });

  it("bounds automatic transient retries", async () => {
    vi.useFakeTimers();
    connectVault.mockRejectedValue(new Error("temporary network failure"));
    const lifecycle = await createLifecycle();

    lifecycle.ready();
    await vi.waitFor(() => expect(connectVault).toHaveBeenCalledTimes(1));
    await vi.runAllTimersAsync();

    expect(connectVault.mock.calls.length).toBeGreaterThan(1);
    expect(connectVault.mock.calls.length).toBeLessThanOrEqual(8);
    connectVault.mockReset().mockResolvedValue({ close: vi.fn() });
    lifecycle.online();
    await vi.waitFor(() => expect(connectVault).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(harness.engineStarted).toBe(1));
    await lifecycle.plugin.onunload();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels a scheduled automatic retry on unload", async () => {
    vi.useFakeTimers();
    connectVault.mockRejectedValue(new Error("temporary network failure"));
    const lifecycle = await createLifecycle();

    lifecycle.ready();
    await vi.waitFor(() => expect(connectVault).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(lifecycle.plugin.status.connectionState).toBe("OFFLINE"));
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    await lifecycle.plugin.onunload();

    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears a pending retry when connection settings change", async () => {
    vi.useFakeTimers();
    connectVault.mockRejectedValueOnce(new Error("temporary network failure"))
      .mockResolvedValueOnce({ close: vi.fn() });
    const lifecycle = await createLifecycle();

    lifecycle.ready();
    await vi.waitFor(() => expect(connectVault).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(lifecycle.plugin.status.connectionState).toBe("OFFLINE"));
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    const outcome = await lifecycle.plugin.applyDraft({
      ...lifecycle.plugin.config, server: "wss://replacement.example.test", natsPassword: "", s3Secret: "",
    } as never, "server");

    expect(outcome).toMatchObject({ kind: "applied" });
    expect(connectVault).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
    await lifecycle.plugin.onunload();
  });

  it("keeps startup, online, and resume signals from overlapping connection attempts", async () => {
    let finish!: (value: { close: () => void }) => void;
    let active = 0;
    let maximumActive = 0;
    connectVault.mockImplementation(() => {
      active++;
      maximumActive = Math.max(maximumActive, active);
      return new Promise((resolve) => { finish = (value) => { active--; resolve(value); }; });
    });
    const lifecycle = await createLifecycle();

    lifecycle.ready();
    await vi.waitFor(() => expect(connectVault).toHaveBeenCalledTimes(1));
    lifecycle.online();
    lifecycle.resume();
    expect(connectVault).toHaveBeenCalledTimes(1);
    finish({ close: vi.fn() });
    await vi.waitFor(() => expect(harness.engineStarted).toBe(1));

    expect(maximumActive).toBe(1);
    expect(harness.engineCreated).toBe(1);
    await lifecycle.plugin.onunload();
  });
});
