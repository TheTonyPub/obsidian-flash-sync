import type { SyncStatus } from "../connection.js";
import type { EasySyncSettings } from "./model.js";

export type Tone = "green" | "yellow" | "red" | "gray";

export interface StatusFact {
  tone: Tone;
  value: string;
  detail: string;
}

export function serverHost(server: string): string {
  try { return new URL(server).host; }
  catch { return server ? "Invalid address" : "Not set"; }
}

export function authFailed(status: SyncStatus): boolean {
  return status.value === "AUTH_ERROR" || status.connectionState === "AUTH_ERROR";
}

export function attachmentFailed(status: SyncStatus): boolean {
  return status.attachmentState === "CONFIGURATION_ERROR" || status.attachmentState === "TRANSFER_ERROR";
}

/** Server or attachment-storage problems that the Server section can fix. */
export function serverNeedsAttention(status: SyncStatus): boolean {
  return authFailed(status) || attachmentFailed(status) ||
    (status.connectionState === "OFFLINE" && Boolean(status.connectionError) && !status.retrying);
}

export function serverFact(status: SyncStatus, settings: EasySyncSettings): StatusFact {
  const detail = serverHost(settings.server);
  if (authFailed(status)) return { tone: "red", value: "Sign-in failed", detail };
  switch (status.connectionState) {
    case "CONNECTED": return { tone: "green", value: "Connected", detail };
    case "CONNECTING": return { tone: "yellow", value: "Connecting…", detail };
    case "UNCONFIGURED": return { tone: "gray", value: "Not configured", detail };
    default: return status.retrying ? { tone: "yellow", value: "Retrying", detail } : { tone: "gray", value: "Offline", detail };
  }
}

export function attachmentFact(status: SyncStatus, settings: EasySyncSettings): StatusFact {
  switch (status.attachmentState) {
    case "NOT_CONFIGURED": return { tone: "gray", value: "Off", detail: "Large files stay on this device" };
    case "CONFIGURATION_ERROR": return { tone: "red", value: "Configuration error", detail: "Check attachment storage" };
    case "TRANSFER_ERROR": return { tone: "red", value: "Transfer error", detail: "Check attachment storage" };
    default: return status.connected
      ? { tone: "green", value: "S3 connected", detail: settings.s3Bucket ? `Bucket ${settings.s3Bucket}` : "Configured" }
      : { tone: "gray", value: "Paused", detail: "Resumes with the server" };
  }
}

function count(value: number, singular: string, plural: string): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

export function queueFact(status: SyncStatus): StatusFact {
  if (status.pending === 0 && status.blobsPending === 0) return { tone: "gray", value: "Nothing", detail: "0 notes · 0 attachments" };
  const parts = [status.pending ? count(status.pending, "note", "notes") : "",
    status.blobsPending ? count(status.blobsPending, "attachment", "attachments") : ""].filter(Boolean);
  return { tone: "yellow", value: parts.join(" · "), detail: status.connected ? "Uploading" : "Saved on this device" };
}

/** Short relative age for display; wall-clock time is never used for ordering. */
export function formatAge(timestamp: number, now = Date.now()): string {
  const minutes = Math.floor(Math.max(0, now - timestamp) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(timestamp).toLocaleDateString();
}
