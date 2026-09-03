/**
 * /r1 .. /rN — ranked resume, and /rn //rp — step navigation.
 * Both are "pick a target from the scanned list, then switchTo()".
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { rankTarget, navTarget, sortByCreated } from "../nav.ts";
import { loadSessions, switchTo } from "./context.ts";
import { MSG } from "./messages.ts";

/** How many /rN commands (and --rN flags) to register. */
export const MAX_RANK = 2;

export const ordinal = (n: number): string => {
  if (n === 1) return "most recent";
  const suffix = n === 2 ? "nd" : n === 3 ? "rd" : "th";
  return `${n}${suffix} most recent`;
};

/** Resume the rank-th most recent session (1 = latest, current excluded). */
export async function resumeRank(rank: number, ctx: ExtensionCommandContext): Promise<void> {
  const s = await loadSessions(ctx);
  if (!s) return;

  const { target, othersCount } = await rankTarget(s.files, s.currentFile, rank, s.hidden);
  if (!target) {
    ctx.ui.notify(othersCount === 0 ? MSG.noOtherSessions : MSG.onlyN(othersCount), "info");
    return;
  }
  await switchTo(ctx, target);
}

/** Step one session older (dir = 1) or newer (dir = -1) than the current. */
export async function resumeStep(dir: 1 | -1, ctx: ExtensionCommandContext): Promise<void> {
  const s = await loadSessions(ctx);
  if (!s) return;

  // Walk by creation time: resuming bumps mtime, which would reshuffle an
  // mtime-ordered walk into a ping-pong between two sessions.
  const { target, pos, total } = await navTarget(sortByCreated(s.files), s.currentFile, dir, s.hidden);
  if (!target) {
    ctx.ui.notify(dir === 1 ? MSG.atOldest : MSG.atNewest, "info");
    return;
  }
  await switchTo(ctx, target, (label) => MSG.resumedAt(pos, total, label));
}

export function registerResumeCommands(pi: ExtensionAPI): void {
  for (let rank = 1; rank <= MAX_RANK; rank++) {
    pi.registerCommand(`r${rank}`, {
      description: `Instantly resume the ${ordinal(rank)} session`,
      handler: async (_args, ctx) => resumeRank(rank, ctx),
    });
  }
  pi.registerCommand("rn", {
    description: "Resume the next (older) session",
    handler: async (_args, ctx) => resumeStep(1, ctx),
  });
  pi.registerCommand("rp", {
    description: "Resume the previous (newer) session",
    handler: async (_args, ctx) => resumeStep(-1, ctx),
  });
}
