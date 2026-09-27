import { describe, expect, it, vi } from "vitest";
import type { BootstrapPlan } from "../../packages/server-cli/src/cli.js";
import { createBootstrapApply, type BootstrapRuntime } from "../../packages/server-cli/src/host-deployment.js";

vi.mock("../../packages/server-cli/src/host.js", () => ({
  readLocalPlatform: vi.fn().mockResolvedValue({ distribution: "ubuntu", release: "24.04", architecture: "amd64" }),
}));

const plan: BootstrapPlan = {
  mode: "native", domain: "sync.example.test", vaultId: "notes",
  installPath: "/etc/flash-osidian-sync", dataPath: "/var/lib/flash-osidian-sync", logPath: "/var/log/flash-osidian-sync",
  systemdServices: ["fos-nats", "fos-caddy"], preview: "fos native plan",
};

function runtime(failNatsValidation = false): BootstrapRuntime {
  return {
    uid: () => 0,
    run: vi.fn().mockImplementation(async (command: readonly string[]) => {
      if (command[0] === "apt-get" && command[1] === "--version") return "apt 2.7";
      if (command[0] === "apt-cache" && command[1] === "show") return "package available";
      if (command[0] === "getent") return "identity exists";
      if (command[0] === "systemctl" && command[1] === "cat") throw new Error("vendor unit absent");
      if (failNatsValidation && command[0] === "nats-server" && command.at(-1) === "-t") {
        throw new Error("nats configuration invalid");
      }
      return "";
    }),
    pathInfo: vi.fn().mockResolvedValue(undefined),
    readText: vi.fn().mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" })),
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeText: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    randomId: () => "native-test",
    resolveDomain: vi.fn().mockResolvedValue(["203.0.113.1"]),
    portReachable: vi.fn().mockResolvedValue(true),
    verifyCertificate: vi.fn().mockResolvedValue(true),
    verifyWss: vi.fn().mockResolvedValue(true),
  };
}

describe("native host deployment runtime wiring", () => {
  it("preflights pinned packages, installs native services, and verifies the endpoint", async () => {
    const host = runtime();

    await createBootstrapApply(host)(plan);

    expect(host.run).toHaveBeenCalledWith(["apt-cache", "show", "nats-server=2.10.7-1ubuntu0.3"]);
    expect(host.run).toHaveBeenCalledWith(["apt-cache", "show", "caddy=2.6.2-6ubuntu0.24.04.3"]);
    expect(host.run).toHaveBeenCalledWith(["apt-get", "install", "--yes", "nats-server=2.10.7-1ubuntu0.3", "caddy=2.6.2-6ubuntu0.24.04.3"]);
    expect(host.run).toHaveBeenCalledWith(["systemctl", "enable", "--now", "fos-nats.service"]);
    expect(host.run).toHaveBeenCalledWith(["systemctl", "enable", "--now", "fos-caddy.service"]);
    expect(host.verifyWss).toHaveBeenCalledWith("wss://sync.example.test", expect.any(Number));
    expect(host.writeText).toHaveBeenCalledWith(expect.stringContaining(".nats-server.conf.native-test.tmp"),
      expect.stringContaining('listen: "127.0.0.1:4222"'), 0o640);
  });

  it("removes newly written native configuration and skips endpoint verification after config validation fails", async () => {
    const host = runtime(true);

    await expect(createBootstrapApply(host)(plan)).rejects.toThrow("nats configuration invalid");

    expect(host.verifyCertificate).not.toHaveBeenCalled();
    expect(host.verifyWss).not.toHaveBeenCalled();
    expect(host.run).toHaveBeenCalledWith(["systemctl", "disable", "--now", "fos-nats.service"]);
    expect(host.run).toHaveBeenCalledWith(["systemctl", "disable", "--now", "fos-caddy.service"]);
    expect(host.remove).toHaveBeenCalledWith(`${plan.installPath}/nats-server.conf`);
    expect(host.remove).toHaveBeenCalledWith(`${plan.installPath}/Caddyfile`);
    expect(host.remove).toHaveBeenCalledWith("/etc/systemd/system/fos-nats.service");
    expect(host.remove).toHaveBeenCalledWith("/etc/systemd/system/fos-caddy.service");
  });
});
