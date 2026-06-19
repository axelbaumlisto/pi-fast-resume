/**
 * pi-fast-resume — fast session resume without reading all .jsonl files.
 *
 * Commands:
 *   /r2              — instantly switch to the most recent session (stat-only)
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

export default function (pi: ExtensionAPI) {
  pi.registerCommand("r2", {
    description: "Instantly resume the most recent session",
    handler: async (_args: string, ctx: any) => {
      const sessionDir = getSessionDir(ctx.cwd);
      const files = await statScan(sessionDir);

      if (files.length === 0) {
        ctx.ui.notify("No sessions found", "error");
        return;
      }

      const currentFile = ctx.sessionManager.getSessionFile() ?? undefined;
      const target = files.find((f: { file: string }) => f.file !== currentFile);

      if (!target) {
        ctx.ui.notify("No other sessions to resume", "info");
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
