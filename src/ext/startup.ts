/**
 * Startup flags (pi --r N / --rN / --rn), active-session registry hooks and
 * the one-off legacy fork migration.
 */

import type { ExtensionAPI, ExtensionContext, SessionStartEvent } from "@earendil-works/pi-coding-agent";
import { statScan } from "../scanner.ts";
import { parseRankFlag } from "../nav.ts";
import { markActive, unmarkActive, activeElsewhere } from "../active.ts";
import { findLegacyForks, migrateLegacyForks } from "../migrate.ts";
import { currentSessionFile, sessionDirFor } from "./context.ts";
import { MAX_RANK, ordinal } from "./resume.ts";
import { MSG } from "./messages.ts";

export type FlagReader = (name: string) => unknown;

/**
 * Which rank the startup flags ask for: --r N wins, then --r1..--rN, then --rn.
 * Pure: takes a flag reader so it can be unit-tested without pi.
 */
export function resolveStartupRank(
  getFlag: FlagReader,
  maxRank = MAX_RANK,
): { rank: number } | { error: string } | undefined {
  const parsed = parseRankFlag(getFlag("r"), maxRank);
  if (parsed) return parsed;
  for (let rank = 1; rank <= maxRank; rank++) {
    if (getFlag(`r${rank}`) === true) return { rank };
  }
  if (getFlag("rn") === true) return { rank: 1 };
  return undefined;
}

/**
 * Move legacy loose subagent forks into `<parent>/forks/`. Runs detached in
 * the background at startup; only reports when something actually moved.
 * Skips the current session and sessions held by other live pi processes.
 */
async function migrateForksInBackground(ctx: ExtensionContext): Promise<void> {
  const files = await statScan(sessionDirFor(ctx));
  const skip = await activeElsewhere();
  const current = currentSessionFile(ctx);
  if (current) skip.add(current);
  const forks = await findLegacyForks(files, skip);
  if (forks.length === 0) return;
  const moved = await migrateLegacyForks(forks);
  if (moved > 0) ctx.ui.notify(MSG.movedForks(moved), "info");
}

async function resumeAtStartup(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
  const wanted = resolveStartupRank((name) => pi.getFlag(name));
  if (!wanted) return;
  if ("error" in wanted) {
    ctx.ui.notify(wanted.error, "error");
    return;
  }
  if (!ctx.hasUI) {
    ctx.ui.notify(MSG.startupNeedsUI, "error");
    return;
  }
  // session_start only gets a plain ExtensionContext (no switchSession), so
  // dispatch our own slash command to run with a command context. Switching
  // while a provider refresh is in flight aborts it and crashes pi (uncaught
  // AbortError from the provider), so let the refresh finish first.
  try {
    await ctx.modelRegistry.refresh();
  } catch {}
  pi.sendUserMessage(`/r${wanted.rank}`, { expandPromptTemplates: true });
}

export function registerStartup(pi: ExtensionAPI): void {
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

  pi.on("session_start", async (event: SessionStartEvent, ctx) => {
    // Advertise which session this pi holds so other instances skip it.
    await markActive(currentSessionFile(ctx));
    if (event.reason !== "startup") return;
    void migrateForksInBackground(ctx).catch(() => {});
    await resumeAtStartup(pi, ctx);
  });

  // Fires on switch (followed by session_start) and on exit.
  pi.on("session_shutdown", async () => {
    await unmarkActive();
  });
}
