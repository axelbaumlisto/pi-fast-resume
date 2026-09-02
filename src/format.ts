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

/**
 * Format one picker row, fitting into `maxWidth` columns (terminal width).
 * Reserves space for the age/size columns and the picker's cursor/indent
 * so rows never wrap (wrapped rows break selection navigation in the TUI).
 */
// Columns reserved at the end of each picker row: the select component's
// cursor/indent (~4) plus the uniquify suffix " (NN)" (5) that
// buildPickerItems() may append to duplicate rows. Rows longer than the
// terminal width either wrap (breaking cursor navigation) or get clipped by
// the component (hiding the suffix), so the label is truncated to fit.
const PICKER_ROW_MARGIN = 10;

/** Label marker for a session currently open in another pi process. */
export const OPEN_ELSEWHERE_MARK = "⦿ ";

export function formatEntry(e: SessionEntry, maxWidth = 80, openElsewhere = false): string {
  const prefix = `${formatAge(e.mtime).padEnd(10)} ${formatSize(e.size).padEnd(8)} `;
  const mark = openElsewhere ? OPEN_ELSEWHERE_MARK : "";
  const labelMax = Math.max(10, maxWidth - prefix.length - mark.length - PICKER_ROW_MARGIN);
  return prefix + mark + truncate(sessionLabel(e), labelMax);
}
