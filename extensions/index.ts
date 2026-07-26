/**
 * pi-fast-resume — fast session resume without reading all .jsonl files.
 *
 * Commands:
 *   /r1 .. /r5       — instantly switch to the N-th most recent session
 *                      (stat-only; /r1 = latest, /r5 = 5th, current excluded)
 *   pi --r N         — same as /rN but at startup (pi --r 1 = resume latest)
 *   pi --r1 .. --r5  — boolean form of the same (pi --r1 = resume latest)
 *   pi --rn          — alias for --r1 (mirrors /rn from a fresh session)
 *   /rn / /rp        — step to the next (older) / previous (newer) session
 *                      relative to the current one (by mtime)
 *   /rs              — paginated session picker (last 20, "Load more", tier filter)
 *   /rs set page N   — set page size (1-50)
 *   /rs set days N   — set maxDays filter (0-30, 0 = no limit)
 *   /rds             — delete all subagent session trees for the current project
 *                      (asks for confirmation; top-level sessions untouched)
 */

import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionCommandContext,
  SessionStartEvent,
} from "@earendil-works/pi-coding-agent";
import {
  statScan,
  scanPage,
  readSessionMeta,
  scanSubagentTrees,
  deleteSubagentTrees,
} from "../src/scanner.ts";
import { formatEntry, truncate, sessionLabel, formatSize } from "../src/format.ts";
import { loadConfig, saveConfig, clampPage, clampDays } from "../src/config.ts";
import { getSessionDir } from "../src/session-dir.ts";
import { rankTarget, navTarget, parseRankFlag } from "../src/nav.ts";
import { buildPickerItems, resolveChoice } from "../src/picker.ts";

const DAY_TIERS = [7, 14, 0] as const;

// How many ranked instant-resume commands to register: /r1 .. /rN.
const MAX_RANK = 5;

const ordinal = (n: number): string => {
  if (n === 1) return "most recent";
  const suffix = n === 2 ? "nd" : n === 3 ? "rd" : "th";
  return `${n}${suffix} most recent`;
};

/** Report a scan error to the user (used as statScan/scanPage onError). */
const scanErrorNotifier = (ctx: ExtensionContext) => (message: string) =>
  ctx.ui.notify(message, "error");

const sessionDirFor = (ctx: ExtensionContext): string =>
  getSessionDir(ctx.cwd, ctx.sessionManager.getSessionFile() ?? undefined);

/** Switch to a session file with a "Resumed: <label>" notice. */
async function switchTo(
  ctx: ExtensionCommandContext,
  target: { file: string; mtime: Date; size: number },
  prefix = "Resumed",
): Promise<void> {
  const meta = await readSessionMeta(target.file, target);
  await ctx.switchSession(target.file, {
    withSession: async (newCtx) => {
      newCtx.ui.notify(`${prefix}: ${truncate(sessionLabel(meta), 50)}`, "info");
    },
  });
}

/**
 * Guard: session switching needs a command-capable interactive context.
 * session_start receives a plain ExtensionContext; in TUI mode the runtime
 * context also carries switchSession, in -p/json modes it does not.
 */
function asSwitchable(ctx: ExtensionContext): ExtensionCommandContext | undefined {
  if (typeof (ctx as ExtensionCommandContext).switchSession === "function") {
    return ctx as ExtensionCommandContext;
  }
  ctx.ui.notify("Session resume is only available in interactive mode", "error");
  return undefined;
}

/** Resume the rank-th most recent session (1 = latest, current excluded). */
async function resumeRank(rank: number, baseCtx: ExtensionContext): Promise<void> {
  const ctx = asSwitchable(baseCtx);
  if (!ctx) return;

  const files = await statScan(sessionDirFor(ctx), scanErrorNotifier(ctx));
  if (files.length === 0) {
    ctx.ui.notify("No sessions found", "error");
    return;
  }

  const currentFile = ctx.sessionManager.getSessionFile() ?? undefined;
  const { target, othersCount } = rankTarget(files, currentFile, rank);

  if (!target) {
    ctx.ui.notify(
      othersCount === 0
        ? "No other sessions to resume"
        : `Only ${othersCount} other session${othersCount === 1 ? "" : "s"} available`,
      "info",
    );
    return;
  }

  await switchTo(ctx, target);
}

export default function (pi: ExtensionAPI) {
  // /r1 .. /rN — jump to the rank-th most recent session.
  for (let rank = 1; rank <= MAX_RANK; rank++) {
    pi.registerCommand(`r${rank}`, {
      description: `Instantly resume the ${ordinal(rank)} session`,
      handler: async (_args, ctx) => resumeRank(rank, ctx),
    });
  }

  // Startup flags: pi --r N, pi --r1 .. --r5, pi --rn (alias for --r1).
  pi.registerFlag("r", {
    description: `Resume the N-th most recent session at startup (1-${MAX_RANK}, 1 = latest)`,
    type: "string",
  });
  for (let rank = 1; rank <= MAX_RANK; rank++) {
    pi.registerFlag(`r${rank}`, {
      description: `Resume the ${ordinal(rank)} session at startup`,
      type: "boolean",
    });
  }
  pi.registerFlag("rn", {
    description: "Resume the most recent session at startup (alias for --r1)",
    type: "boolean",
  });

  /** Resolve requested startup rank from flags, or undefined if none set. */
  const startupRank = (ctx: ExtensionContext): number | undefined => {
    const parsed = parseRankFlag(pi.getFlag("r"), MAX_RANK);
    if (parsed) {
      if ("error" in parsed) {
        ctx.ui.notify(parsed.error, "error");
        return undefined;
      }
      return parsed.rank;
    }
    for (let rank = 1; rank <= MAX_RANK; rank++) {
      if (pi.getFlag(`r${rank}`) === true) return rank;
    }
    if (pi.getFlag("rn") === true) return 1;
    return undefined;
  };

  pi.on("session_start", async (event: SessionStartEvent, ctx) => {
    if (event.reason !== "startup") return;
    const rank = startupRank(ctx);
    if (rank !== undefined) await resumeRank(rank, ctx);
  });

  // /rn — step to the next OLDER session; /rp — step to the next NEWER one.
  const NAV = [
    { cmd: "rn", dir: 1, desc: "Resume the next (older) session", edge: "Already at the oldest session" },
    { cmd: "rp", dir: -1, desc: "Resume the previous (newer) session", edge: "Already at the newest session" },
  ] as const;

  for (const { cmd, dir, desc, edge } of NAV) {
    pi.registerCommand(cmd, {
      description: desc,
      handler: async (_args, ctx) => {
        const files = await statScan(sessionDirFor(ctx), scanErrorNotifier(ctx));
        if (files.length === 0) {
          ctx.ui.notify("No sessions found", "error");
          return;
        }

        const currentFile = ctx.sessionManager.getSessionFile() ?? undefined;
        const { target, pos, total } = navTarget(files, currentFile, dir);

        if (!target) {
          ctx.ui.notify(edge, "info");
          return;
        }

        await switchTo(ctx, target, `Resumed (${pos}/${total})`);
      },
    });
  }

  pi.registerCommand("rds", {
    description: "Delete subagent session trees for the current project (with confirmation)",
    handler: async (_args, ctx) => {
      const sessionDir = sessionDirFor(ctx);
      const trees = await scanSubagentTrees(sessionDir);

      if (trees.length === 0) {
        ctx.ui.notify("No subagent sessions to delete for this project", "info");
        return;
      }

      const totalRuns = trees.reduce((s, t) => s + t.runs, 0);
      const totalBytes = trees.reduce((s, t) => s + t.bytes, 0);

      const summary =
        `Delete ${trees.length} subagent tree${trees.length === 1 ? "" : "s"} ` +
        `(${totalRuns} run${totalRuns === 1 ? "" : "s"}, ${formatSize(totalBytes)})?`;

      const choice = await ctx.ui.select(summary, [
        `Delete ${trees.length} tree${trees.length === 1 ? "" : "s"} (${formatSize(totalBytes)})`,
        "Cancel",
      ]);

      if (!choice || choice === "Cancel") {
        ctx.ui.notify("Cancelled — nothing deleted", "info");
        return;
      }

      const removed = await deleteSubagentTrees(sessionDir, trees);
      ctx.ui.notify(
        `Deleted ${removed}/${trees.length} subagent tree${removed === 1 ? "" : "s"} ` +
          `(${formatSize(totalBytes)} freed)`,
        removed === trees.length ? "info" : "error",
      );
    },
  });

  pi.registerCommand("rs", {
    description: "Smart resume: paginated session picker (last 20, Load more, tier filter)",
    handler: async (args, ctx) => {
      const parts = (args || "").trim().split(/\s+/);
      const cfg = loadConfig();

      // /rs set                → show current config
      // /rs set page N | days N → update (out-of-range values are clamped)
      if (parts[0] === "set") {
        const key = parts[1];
        const val = parseInt(parts[2] ?? "", 10);

        if (!key) {
          ctx.ui.notify(
            `Current: page ${cfg.pageSize}, days ${cfg.maxDays || "off"} — /rs set page N | /rs set days N`,
            "info",
          );
          return;
        }

        let applied: string | undefined;
        if (key === "page" && !isNaN(val)) {
          cfg.pageSize = clampPage(val);
          applied =
            cfg.pageSize === val
              ? `Page size set to ${val}`
              : `Page size clamped to ${cfg.pageSize} (valid: 1-50)`;
        } else if (key === "days" && !isNaN(val)) {
          cfg.maxDays = clampDays(val);
          applied =
            cfg.maxDays === 0
              ? "Day filter disabled"
              : cfg.maxDays === val
                ? `Max days set to ${val}`
                : `Max days clamped to ${cfg.maxDays} (valid: 0-30)`;
        }

        if (!applied) {
          ctx.ui.notify("Usage: /rs set page N (1-50) | /rs set days N (0-30)", "error");
          return;
        }

        const saveError = saveConfig(cfg);
        ctx.ui.notify(saveError ?? applied, saveError ? "error" : "info");
        return;
      }

      const sessionDir = sessionDirFor(ctx);
      const currentFile = ctx.sessionManager.getSessionFile() ?? undefined;
      const onError = scanErrorNotifier(ctx);

      let tierIndex = 0;
      let offset = 0;

      while (true) {
        const currentDays = DAY_TIERS[tierIndex] ?? 0;
        const nextTierDays = DAY_TIERS[tierIndex + 1];

        const { entries, total, hasMore } = await scanPage(
          sessionDir,
          offset,
          cfg.pageSize,
          currentDays > 0 ? currentDays : undefined,
          currentFile,
          onError,
        );

        if (entries.length === 0 && offset === 0) {
          if (tierIndex < DAY_TIERS.length - 1) {
            tierIndex++;
            continue;
          }
          ctx.ui.notify("No sessions found", "info");
          return;
        }

        const termWidth = process.stdout.columns || 80;
        const items = buildPickerItems(
          entries.map((e) => formatEntry(e, termWidth)),
          {
            remaining: hasMore ? total - offset - entries.length : undefined,
            nextTierLabel:
              nextTierDays !== undefined ? (nextTierDays > 0 ? `${nextTierDays}d` : "all") : undefined,
          },
        );

        const filterLabel = currentDays > 0 ? ` (last ${currentDays}d)` : "";
        const rangeLabel = `Sessions ${offset + 1}-${offset + entries.length} of ${total}${filterLabel}`;

        const choice = await ctx.ui.select(rangeLabel, items);
        const action = resolveChoice(items, choice, entries.length);

        switch (action.kind) {
          case "more":
            offset += cfg.pageSize;
            continue;
          case "tier":
            tierIndex++;
            offset = 0;
            continue;
          case "entry": {
            const selected = entries[action.index];
            if (!selected) return;
            const result = await ctx.switchSession(selected.file, {
              withSession: async (newCtx) => {
                newCtx.ui.notify(`Resumed: ${truncate(sessionLabel(selected), 50)}`, "info");
              },
            });
            if (result.cancelled) {
              ctx.ui.notify("Session switch was cancelled", "info");
            }
            return;
          }
          case "cancel":
            return;
        }
      }
    },
  });
}
