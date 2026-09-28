import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";

// Route only this test's native adapters to a disposable random loopback port.
// The real NATS transport, authentication, KV, and permission checks still run.
const route = vi.hoisted(() => ({ url: "" }));
vi.mock("@nats-io/transport-node", async () => {
  const actual = await vi.importActual<typeof import("@nats-io/transport-node")>("@nats-io/transport-node");
  return { ...actual, connect: (options: Parameters<typeof actual.connect>[0]) => actual.connect({ ...options, servers: route.url }) };
});
import { connect } from "@nats-io/transport-node";
import { Kvm } from "@nats-io/kv";
import { createNativeVaultAdminAdapter, createNativeVaultVerificationAdapter } from "../../packages/server-cli/src/native-admin.js";
import { runVaultCommand } from "../../packages/server-cli/src/cli.js";
import { generateBootstrapCredentials } from "../../packages/server-cli/src/credentials.js";
import { renderManagedAuthorization, type ManagedAuthorization } from "../../packages/server-cli/src/vault-users.js";

it.skipIf(!process.env.NATS_SERVER_BIN)("creates a guided vault on disposable NATS and preserves an existing vault", async () => {
  const socket = createServer();
  await new Promise<void>((resolve, reject) => { socket.once("error", reject); socket.listen(0, "127.0.0.1", resolve); });
  const address = socket.address(); if (!address || typeof address === "string") throw new Error("NO_TEST_PORT");
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  route.url = `nats://127.0.0.1:${address.port}`;
  const directory = await mkdtemp(join(tmpdir(), "fos-guided-nats-"));
  let server: ChildProcess | undefined;
  const generated = generateBootstrapCredentials("existing");
  const administrator = { username: generated.administrator.username, password: generated.administrator.password };
  let authorization: ManagedAuthorization = { administrator: { username: "fos-admin", passwordHash: generated.administrator.passwordHash }, users: [] };
  const config = join(directory, "nats.conf");
  const prefix = `listen: "127.0.0.1:${address.port}"\njetstream { store_dir: ${JSON.stringify(join(directory, "store"))} }\n`;
  const openAdmin = () => connect({ ...administrator, user: administrator.username, pass: administrator.password, maxReconnectAttempts: 0, timeout: 2000 });
  try {
    await writeFile(config, prefix + renderManagedAuthorization(authorization), { mode: 0o600 });
    server = spawn(process.env.NATS_SERVER_BIN!, ["-c", config], { stdio: "ignore" });
    for (let retry = 0; retry < 5; retry++) {
      try { const connection = await openAdmin(); await connection.close(); break; }
      catch (error) { if (retry === 4) throw new Error("DISPOSABLE_NATS_START_FAILED", { cause: error }); await new Promise((resolve) => setTimeout(resolve, 20)); }
    }
    const seedConnection = await openAdmin();
    try {
      const seed = await new Kvm(seedConnection).create("OBS_existing_FILES", { history: 10 });
      await seed.put("f.seed", new TextEncoder().encode("preserved content"));
    } finally { await seedConnection.close(); }
    const adminAdapter = createNativeVaultAdminAdapter(administrator);
    const write = vi.fn(async (rendered: string) => {
      await writeFile(config, prefix + rendered, { mode: 0o600 });
      authorization = { ...authorization, users: [...rendered.matchAll(/user: "(fos-vault-([A-Za-z0-9_-]+))", password: "([^"]+)"/g)]
        .map((match) => ({ username: match[1], vaultId: match[2], passwordHash: match[3] })) };
    });
    const reload = async () => { server!.kill("SIGHUP"); await new Promise((resolve) => setTimeout(resolve, 100)); };
    const output = { writeFileAtomically: vi.fn(async (path: string, content: string) => { await writeFile(path, content, { mode: 0o600 }); }) };
    const options = {
      host: { platform: () => ({ distribution: "debian", release: "13", architecture: "amd64" }) },
      resolveMode: async () => "native" as const,
      createAdminAdapter: () => adminAdapter,
      createAdapter: () => ({ authenticate: (credentials: typeof administrator) => adminAdapter.authenticate(credentials), readAuthorization: async () => authorization,
        validate: async () => {}, write, reload, restore: async (rendered: string) => { await writeFile(config, prefix + rendered); await reload(); } }),
      createVerificationAdapter: createNativeVaultVerificationAdapterForPlan,
      credentialStore: { readAdministrator: async () => ({ kind: "administrator" as const, ...administrator, endpoint: "wss://fixture.example.test" }) },
      secretOutput: output, showReview: vi.fn(),
      prompts: { select: vi.fn(), input: vi.fn(), password: vi.fn(), confirm: vi.fn().mockResolvedValue(true) },
    };
    const handoff = join(directory, "handoff");
    await runVaultCommand(["add", "--vault-id", "new_vault", "--secrets-output", handoff], options);
    expect(write).toHaveBeenCalledOnce(); expect(output.writeFileAtomically).toHaveBeenCalledOnce();
    expect(options.prompts.confirm).toHaveBeenCalledOnce();
    const nc = await openAdmin();
    try {
      const kv = await new Kvm(nc).open("OBS_new_vault_FILES");
      expect((await kv.status()).bucket).toBe("OBS_new_vault_FILES");
      const seed = await new Kvm(nc).open("OBS_existing_FILES");
      expect(new TextDecoder().decode((await seed.get("f.seed"))?.value)).toBe("preserved content");
    } finally { await nc.close(); }
    await runVaultCommand(["add", "--vault-id", "new_vault", "--secrets-output", handoff], options);
    expect(write).toHaveBeenCalledOnce(); expect(output.writeFileAtomically).toHaveBeenCalledOnce();
    expect(options.prompts.confirm).toHaveBeenCalledOnce();
  } finally {
    if (server && server.exitCode === null) {
      server.kill("SIGTERM"); await new Promise<void>((resolve) => server!.once("exit", () => resolve()));
    }
    await rm(directory, { recursive: true, force: true });
  }
}, 20000);

function createNativeVaultVerificationAdapterForPlan(_plan: unknown, credentials: { username: string; password: string }) {
  return createNativeVaultVerificationAdapter(credentials);
}
