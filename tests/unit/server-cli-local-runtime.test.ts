import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { EventEmitter } from "node:events";
import { promises as dns } from "node:dns";
import { connect as connectTcp } from "node:net";
import { connect as connectTls } from "node:tls";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalRuntime } from "../../packages/server-cli/src/host-deployment.js";

vi.mock("node:dns", () => ({ promises: { resolve: vi.fn() } }));
vi.mock("node:net", () => ({ connect: vi.fn() }));
vi.mock("node:tls", () => ({ connect: vi.fn() }));

function fakeSocket(authorized = true) {
  const socket = new EventEmitter() as EventEmitter & {
    authorized: boolean;
    setTimeout: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
  };
  socket.authorized = authorized;
  socket.setTimeout = vi.fn();
  socket.destroy = vi.fn();
  socket.write = vi.fn().mockImplementation(() => {
    queueMicrotask(() => socket.emit("data", Buffer.from("HTTP/1.1 101 Switching Protocols\r\n\r\n")));
  });
  return socket;
}

beforeEach(() => vi.resetAllMocks());

describe("local bootstrap runtime", () => {
  it("runs commands and streams one-shot input over stdin, reporting child failures", async () => {
    const runtime = createLocalRuntime();
    expect(runtime.uid()).toBe(process.getuid?.() ?? -1);
    const output = await runtime.run([process.execPath, "-e", "process.stdout.write('ready')"]);
    expect(output).toBe("ready");

    const privateInput = "private-admin-input";
    const streamed = await runtime.runWithInput!([process.execPath, "-e",
      "let value='';process.stdin.setEncoding('utf8');process.stdin.on('data', chunk => value += chunk);process.stdin.on('end', () => process.stdout.write(value))"], privateInput);
    expect(streamed).toBe(privateInput);

    await expect(runtime.runWithInput!([process.execPath, "-e", "process.stderr.write('child failed');process.exit(9)"], "input"))
      .rejects.toThrow("child failed");
  });

  it("creates, inspects, renames, removes, and recursively removes host files with protected modes", async () => {
    const runtime = createLocalRuntime();
    const root = await mkdtemp(join(tmpdir(), "fos-local-runtime-"));
    try {
      const nested = join(root, "nested");
      const source = join(nested, "secret.txt");
      const destination = join(nested, "renamed.txt");
      expect(await runtime.pathInfo(source)).toBeUndefined();
      await runtime.mkdir(nested);
      await runtime.writeText(source, "protected", 0o600);
      expect(((await runtime.pathInfo(source))?.mode ?? 0) & 0o777).toBe(0o600);
      expect(await runtime.readText(source)).toBe("protected");

      const link = join(root, "secret-link");
      await symlink(source, link);
      expect((await runtime.pathInfo(link))?.isSymbolicLink).toBe(true);
      await runtime.rename(source, destination);
      expect(await readFile(destination, "utf8")).toBe("protected");
      await runtime.remove(destination);
      expect(await runtime.pathInfo(destination)).toBeUndefined();
      await runtime.removeTree!(root);
      expect(await runtime.pathInfo(link)).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects malformed WebSocket URLs before attempting a network connection", async () => {
    await expect(createLocalRuntime().verifyWss("not a URL")).rejects.toThrow();
  });

  it("resolves domain records through the operating-system DNS adapter", async () => {
    vi.mocked(dns.resolve).mockResolvedValueOnce(["203.0.113.4"] as never);

    await expect(createLocalRuntime().resolveDomain("sync.example.test")).resolves.toEqual(["203.0.113.4"]);
    expect(dns.resolve).toHaveBeenCalledWith("sync.example.test");
  });

  it("reports TCP reachability and closes a successful probe socket", async () => {
    const socket = fakeSocket();
    vi.mocked(connectTcp).mockImplementationOnce(() => {
      queueMicrotask(() => socket.emit("connect"));
      return socket as unknown as ReturnType<typeof connectTcp>;
    });

    await expect(createLocalRuntime().portReachable(443)).resolves.toBe(true);
    expect(connectTcp).toHaveBeenCalledWith({ host: "127.0.0.1", port: 443 });
    expect(socket.destroy).toHaveBeenCalledOnce();
    expect(socket.setTimeout).toHaveBeenCalledWith(5_000);
  });

  it("reports an unavailable TCP port as unreachable", async () => {
    const socket = fakeSocket();
    vi.mocked(connectTcp).mockImplementationOnce(() => {
      queueMicrotask(() => socket.emit("error", new Error("ECONNREFUSED")));
      return socket as unknown as ReturnType<typeof connectTcp>;
    });

    await expect(createLocalRuntime().portReachable(80)).resolves.toBe(false);
  });

  it("verifies certificate authorization and rejects an untrusted certificate", async () => {
    const accepted = fakeSocket(true);
    vi.mocked(connectTls).mockImplementationOnce(() => {
      queueMicrotask(() => accepted.emit("secureConnect"));
      return accepted as unknown as ReturnType<typeof connectTls>;
    });
    await expect(createLocalRuntime().verifyCertificate("sync.example.test", 125)).resolves.toBe(true);
    expect(connectTls).toHaveBeenCalledWith({ host: "sync.example.test", port: 443,
      servername: "sync.example.test", rejectUnauthorized: true });

    const rejected = fakeSocket(false);
    vi.mocked(connectTls).mockImplementationOnce(() => {
      queueMicrotask(() => rejected.emit("secureConnect"));
      return rejected as unknown as ReturnType<typeof connectTls>;
    });
    await expect(createLocalRuntime().verifyCertificate("sync.example.test")).resolves.toBe(false);
  });

  it("sends a WebSocket upgrade and returns false for a non-upgrade response", async () => {
    const socket = fakeSocket();
    socket.write = vi.fn().mockImplementation(() => {
      queueMicrotask(() => socket.emit("data", Buffer.from("HTTP/1.1 403 Forbidden\r\n\r\n")));
    });
    vi.mocked(connectTls).mockImplementationOnce(() => {
      queueMicrotask(() => socket.emit("secureConnect"));
      return socket as unknown as ReturnType<typeof connectTls>;
    });

    await expect(createLocalRuntime().verifyWss("wss://sync.example.test/sync")).resolves.toBe(false);
    expect(socket.write.mock.calls[0]?.[0]).toContain("GET /sync HTTP/1.1");
    expect(socket.write.mock.calls[0]?.[0]).toContain("Upgrade: websocket");

    const upgraded = fakeSocket();
    vi.mocked(connectTls).mockImplementationOnce(() => {
      queueMicrotask(() => upgraded.emit("secureConnect"));
      return upgraded as unknown as ReturnType<typeof connectTls>;
    });
    await expect(createLocalRuntime().verifyWss("wss://sync.example.test/sync")).resolves.toBe(true);
  });
});
