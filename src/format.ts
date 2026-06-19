/**
 * Pure formatting functions. No pi SDK dependency.
 */

import type { SessionEntry } from "./scanner.ts";

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / 1048576).toFixed(1)}MB`;
}

export function formatAge(mtime: Date): string {
  const diff = Date.now() - mtime.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 3) + "..." : text;
}

export function sessionLabel(e: SessionEntry): string {
  return e.name || e.firstMessage || e.id || "untitled";
}

export function formatEntry(e: SessionEntry): string {
  return `${formatAge(e.mtime).padEnd(10)} ${formatSize(e.size).padEnd(8)} ${truncate(sessionLabel(e), 60)}`;
}
