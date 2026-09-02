/** /rs — paginated session picker, plus `/rs set` config. */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { scanPage } from "../scanner.ts";
import { formatEntry } from "../format.ts";
import { loadConfig, saveConfig, applySetting, type Config } from "../config.ts";
import { buildPickerItems, resolveChoice } from "../picker.ts";
import { activeElsewhere } from "../active.ts";
import { currentSessionFile, sessionDirFor, notifyError, switchTo } from "./context.ts";
import { MSG } from "./messages.ts";

/** Day-filter tiers the picker escalates through: 7d → 14d → all. */
const DAY_TIERS = [7, 14, 0] as const;

const tierLabel = (days: number) => (days > 0 ? `${days}d` : "all");

function handleSet(ctx: ExtensionCommandContext, cfg: Config, key?: string, value?: string): void {
  if (!key) {
    ctx.ui.notify(MSG.set.current(cfg.pageSize, cfg.maxDays), "info");
    return;
  }
  const res = applySetting(cfg, key, value);
  if ("error" in res) {
    ctx.ui.notify(MSG.set.usage, "error");
    return;
  }
  const saveError = saveConfig(res.cfg);
  ctx.ui.notify(saveError ?? res.message, saveError ? "error" : "info");
}

async function runPicker(ctx: ExtensionCommandContext, cfg: Config): Promise<void> {
  const sessionDir = sessionDirFor(ctx);
  const currentFile = currentSessionFile(ctx);
  const onError = notifyError(ctx);
  // The picker SHOWS sessions open in another pi (marked) instead of hiding
  // them, so the user can see where a "missing" chat went; selecting one is
  // refused rather than hijacking the other instance's session.
  const elsewhere = await activeElsewhere();
  const termWidth = process.stdout.columns || 80;

  let tierIndex = 0;
  let offset = 0;

  while (true) {
    const days = DAY_TIERS[tierIndex] ?? 0;
    const nextTier = DAY_TIERS[tierIndex + 1];

    const { entries, total, hasMore } = await scanPage(
      sessionDir, offset, cfg.pageSize, days > 0 ? days : undefined, currentFile, onError,
    );

    if (entries.length === 0 && offset === 0) {
      if (nextTier !== undefined) {
        tierIndex++;
        continue;
      }
      ctx.ui.notify(MSG.noSessions, "info");
      return;
    }

    const items = buildPickerItems(
      entries.map((e) => formatEntry(e, termWidth, elsewhere.has(e.file))),
      {
        remaining: hasMore ? total - offset - entries.length : undefined,
        nextTierLabel: nextTier !== undefined ? tierLabel(nextTier) : undefined,
      },
    );

    const filter = days > 0 ? ` (last ${days}d)` : "";
    const title = `Sessions ${offset + 1}-${offset + entries.length} of ${total}${filter}`;
    const action = resolveChoice(items, await ctx.ui.select(title, items), entries.length);

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
        if (elsewhere.has(selected.file)) {
          ctx.ui.notify(MSG.openElsewhere, "info");
          continue;
        }
        const result = await switchTo(ctx, selected);
        if (result.cancelled) ctx.ui.notify(MSG.switchCancelled, "info");
        return;
      }
      case "cancel":
        return;
    }
  }
}

export function registerPicker(pi: ExtensionAPI): void {
  pi.registerCommand("rs", {
    description: "Smart resume: paginated session picker (last 20, Load more, tier filter)",
    handler: async (args, ctx) => {
      const [sub, key, value] = (args || "").trim().split(/\s+/);
      const cfg = loadConfig();
      if (sub === "set") return handleSet(ctx, cfg, key, value);
      await runPicker(ctx, cfg);
    },
  });
}
