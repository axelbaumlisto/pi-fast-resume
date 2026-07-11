/**
 * pi-fast-resume — fast session resume without reading all .jsonl files.
 *
 * Commands:
 *   /r1 .. /r5       — instantly switch to the N-th most recent session
 *                      (stat-only; /r1 = latest, /r5 = 5th, current excluded)
 *   /rs              — paginated session picker (last 20, "Load more", tier filter)
 *   /rs set page N   — set page size (1-50)
 *   /rs set days N   — set maxDays filter (0-30, 0 = no limit)
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { statScan, scanPage, readSessionMeta } from "../src/scanner.ts";
import { formatEntry, truncate, sessionLabel } from "../src/format.ts";
import { loadConfig, saveConfig } from "../src/config.ts";
import { getSessionDir } from "../src/session-dir.ts";

const DAY_TIERS = [7, 14, 0] as const;

// How many ranked instant-resume commands to register: /r1 .. /rN.
const MAX_RANK = 5;

const ordinal = (n: number): string => {
  if (n === 1) return "most recent";
  const suffix = n === 2 ? "nd" : n === 3 ? "rd" : "th";
  return `${n}${suffix} most recent`;
};

export default function (pi: ExtensionAPI) {
  // Register /r1 .. /rN — each jumps to the rank-th most recent session
  // (by mtime, current session excluded). /r1 = latest, /r2 = 2nd, etc.
  for (let rank = 1; rank <= MAX_RANK; rank++) {
    pi.registerCommand(`r${rank}`, {
      description: `Instantly resume the ${ordinal(rank)} session`,
      handler: async (_args: string, ctx: any) => {
        const sessionDir = getSessionDir(ctx.cwd);
        const files = await statScan(sessionDir);

        if (files.length === 0) {
          ctx.ui.notify("No sessions found", "error");
          return;
        }

        const currentFile = ctx.sessionManager.getSessionFile() ?? undefined;
        const others = files.filter((f: { file: string }) => f.file !== currentFile);

        const target = others[rank - 1];
        if (!target) {
          ctx.ui.notify(
            others.length === 0
              ? "No other sessions to resume"
              : `Only ${others.length} other session${others.length === 1 ? "" : "s"} available`,
            "info",
          );
          return;
        }

        const meta = await readSessionMeta(target.file, target);
        await ctx.switchSession(target.file, {
          withSession: async (newCtx: any) => {
            newCtx.ui.notify(`Resumed: ${truncate(sessionLabel(meta), 50)}`, "info");
          },
        });
      },
    });
  }

  pi.registerCommand("rs", {
    description: "Smart resume: paginated session picker (last 20, Load more, tier filter)",
    handler: async (args: string, ctx: any) => {
      const parts = (args || "").trim().split(/\s+/);
      const cfg = loadConfig();

      // /rs set page N | /rs set days N
      if (parts[0] === "set") {
        const key = parts[1];
        const val = parseInt(parts[2], 10);

        if (key === "page" && !isNaN(val) && val >= 1 && val <= 50) {
          cfg.pageSize = val;
          saveConfig(cfg);
          ctx.ui.notify(`Page size set to ${val}`, "info");
          return;
        }
        if (key === "days" && !isNaN(val) && val >= 0 && val <= 30) {
          cfg.maxDays = val;
          saveConfig(cfg);
          ctx.ui.notify(val === 0 ? "Day filter disabled" : `Max days set to ${val}`, "info");
          return;
        }

        ctx.ui.notify("Usage: /rs set page N (1-50) | /rs set days N (0-30)", "error");
        return;
      }

      const sessionDir = getSessionDir(ctx.cwd);
      const currentFile = ctx.sessionManager.getSessionFile() ?? undefined;

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
        );

        if (entries.length === 0 && offset === 0) {
          if (tierIndex < DAY_TIERS.length - 1) {
            tierIndex++;
            continue;
          }
          ctx.ui.notify("No sessions found", "info");
          return;
        }

        const items: string[] = entries.map((e) => formatEntry(e));

        if (hasMore) {
          const remaining = total - offset - entries.length;
          items.push(`▼ Load more... (${remaining} remaining)`);
        }

        if (nextTierDays !== undefined) {
          const tierLabel = nextTierDays > 0 ? `${nextTierDays}d` : "all";
          items.push(`▼ Show ${tierLabel}`);
        }

        const filterLabel = currentDays > 0 ? ` (last ${currentDays}d)` : "";
        const rangeLabel =
          offset === 0
            ? `Sessions 1-${entries.length} of ${total}${filterLabel}`
            : `Sessions ${offset + 1}-${offset + entries.length} of ${total}${filterLabel}`;

        const choice = await ctx.ui.select(rangeLabel, items);

        if (choice === undefined || choice === null) return;

        const choiceIndex = items.indexOf(choice);

        if (hasMore && choiceIndex === entries.length) {
          offset += cfg.pageSize;
          continue;
        }

        if (choice.startsWith("▼ Show ") && nextTierDays !== undefined) {
          tierIndex++;
          offset = 0;
          continue;
        }

        if (choiceIndex >= 0 && choiceIndex < entries.length) {
          const selected = entries[choiceIndex];
          if (!selected) return;

          const result = await ctx.switchSession(selected.file, {
            withSession: async (newCtx: any) => {
              newCtx.ui.notify(`Resumed: ${truncate(sessionLabel(selected), 50)}`, "info");
            },
          });

          if (result.cancelled) {
            ctx.ui.notify("Session switch was cancelled", "info");
          }
          return;
        }

        return;
      }
    },
  });
}
