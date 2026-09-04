/** All user-facing strings in one place. */
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export const MSG = {
  noSessions: "No sessions found",
  noOtherSessions: "No other sessions to resume",
  onlyN: (n: number) => `Only ${plural(n, "other session")} available`,
  resumed: (label: string) => `Resumed: ${label}`,
  resumedAt: (pos: number, total: number, label: string) => `Resumed (${pos}/${total}): ${label}`,
  atOldest: "Already at the oldest session",
  atNewest: "Already at the newest session",
  openElsewhere: "That session is open in another pi — not switching",
  switchCancelled: "Session switch was cancelled",
  continueBusy: "That session is open in another pi — resuming the most recent free one",
  movedForks: (n: number) => `Moved ${plural(n, "legacy subagent fork session")} into <parent>/forks/`,
  rds: {
    none: "No subagent sessions to delete for this project",
    confirm: (trees: number, runs: number, size: string) =>
      `Delete ${plural(trees, "subagent tree")} (${plural(runs, "run")}, ${size})?`,
    deleteOption: (trees: number, size: string) => `Delete ${plural(trees, "tree")} (${size})`,
    cancel: "Cancel",
    cancelled: "Cancelled — nothing deleted",
    done: (removed: number, total: number, size: string) =>
      `Deleted ${removed}/${total} subagent tree${removed === 1 ? "" : "s"} (${size} freed)`,
  },
  set: {
    current: (page: number, days: number) =>
      `Current: page ${page}, days ${days || "off"} — /rs set page N | /rs set days N`,
    usage: "Usage: /rs set page N (1-50) | /rs set days N (0-30)",
  },
} as const;
