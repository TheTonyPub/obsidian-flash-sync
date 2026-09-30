import type { SyncStatus } from "./connection.js";

export type LogFields = Record<string, string | number | boolean | undefined>;

export interface PluginLogger {
  debug(event: string, fields?: LogFields): void;
  error(event: string, cause: unknown, fields?: LogFields): void;
}

function timestamp(): string {
  return new Date().toISOString();
}

function redact(text: string): string {
  return text.replace(/\b(?:wss?|https?):\/\/[^\s"'<>]+/gi, (value) => {
    try {
      const url = new URL(value);
      url.username = "";
      url.password = "";
      url.search = "";
      url.hash = "";
      return url.toString();
    } catch { return "[URL redacted]"; }
  });
}

export function errorSummary(error: unknown): string {
  const messages: string[] = [];
  const visited = new Set<unknown>();
  let current: unknown = error;
  while (current !== undefined && current !== null && !visited.has(current) && messages.length < 5) {
    visited.add(current);
    messages.push(redact(current instanceof Error ? current.message : String(current)));
    current = current instanceof Error ? current.cause : undefined;
  }
  return messages.filter(Boolean).join(" → ") || "Unknown error";
}

export function createLogger(debugEnabled: () => boolean, sink: Pick<Console, "debug" | "error"> = console,
  redact: (message: string) => string = (message) => message): PluginLogger {
  return {
    debug(event, fields) {
      if (debugEnabled()) sink.debug(`[flash-sync] ${timestamp()} ${event}`, fields ?? {});
    },
    error(event, cause, fields) {
      sink.error(`[flash-sync] ${timestamp()} ${event}: ${redact(errorSummary(cause))}`, fields ?? {});
    },
  };
}

export interface StatusReportConfig {
  vaultId: string;
  server: string;
  debugLogging: boolean;
  inlineLimit: number;
  statusBarMode: string;
}

export interface StatusReportOptions {
  pluginVersion: string;
  platform: "desktop" | "mobile";
  now?: Date;
  /** Removes active secret values, such as the plugin's SecretStorage entries. */
  redact?: (message: string) => string;
}

function serverHost(server: string): string {
  if (!server) return "not set";
  try { return new URL(server).host || "invalid address"; }
  catch { return "invalid address"; }
}

function reportLine(message: string, redactSecrets: (message: string) => string): string {
  return redactSecrets(errorSummary(message))
    .replace(/\bobsidian:\/\/\S+/gi, "[link redacted]")
    .replace(/\b[12]\.[A-Za-z0-9_-]{24,}/g, "[transfer code redacted]")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 300);
}

/** Plain-text summary for bug reports: states, counts and redacted recent errors, never secrets or payloads. */
export function buildStatusReport(status: SyncStatus, config: StatusReportConfig, options: StatusReportOptions): string {
  const redactSecrets = options.redact ?? ((message: string) => message);
  const errors = [
    ["Connection", status.connectionError],
    ["Attachments", status.attachmentError],
    ["Last error", status.lastError],
  ].filter(([, message]) => message).map(([label, message]) => `- ${label}: ${reportLine(message!, redactSecrets)}`);
  return [
    "flash-sync status report",
    `Generated: ${(options.now ?? new Date()).toISOString()}`,
    `Plugin version: ${options.pluginVersion}`,
    `Platform: ${options.platform}`,
    `Vault ID: ${config.vaultId}`,
    `Status: ${status.value}`,
    `Sync server: ${status.connectionState} (${serverHost(config.server)})${status.retrying ? " · retrying" : ""}`,
    `Attachments: ${status.attachmentState}`,
    `Reconciled: ${status.reconciled ? "yes" : "no"}`,
    `Last reconciled: ${status.lastReconciledAt ? new Date(status.lastReconciledAt).toISOString() : "never"}`,
    `Pending note changes: ${status.pending}`,
    `Pending attachment transfers: ${status.blobsPending}`,
    `Conflicts: ${Math.max(status.conflicts, status.conflictPaths.length)}`,
    `Errors: ${status.errors}`,
    `Inline limit: ${Math.round(config.inlineLimit / 1024)} KiB`,
    `Debug logging: ${config.debugLogging ? "on" : "off"}`,
    `Status bar: ${config.statusBarMode}`,
    errors.length ? "Recent errors:" : "Recent errors: none",
    ...errors,
  ].join("\n");
}
