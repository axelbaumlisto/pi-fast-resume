/**
 * Shared glue between pi contexts and the pure src/ modules.
 * Everything that touches ExtensionContext but isn't a command lives here.
 */

import type { ExtensionContext, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { statScan, readSessionMeta, type StatResult } from "../scanner.ts";
import { getSessionDir } from "../session-dir.ts";
import { activeElsewhere } from "../active.ts";
import { truncate, sessionLabel } from "../format.ts";
import type { Hidden } from "../nav.ts";
import { MSG } from "./messages.ts";

export const LABEL_MAX = 50;

export const currentSessionFile = (ctx: ExtensionContext): string | undefined =>
  ctx.sessionManager.getSessionFile() ?? undefined;

export const sessionDirFor = (ctx: ExtensionContext): string =>
  getSessionDir(ctx.cwd, currentSessionFile(ctx));

export const notifyError = (ctx: ExtensionContext) => (message: string) => ctx.ui.notify(message, "error");

export interface SessionSet {
  files: StatResult[];
  currentFile: string | undefined;
  /** Sessions open in another live pi process. */
  elsewhere: Set<string>;
  /** Hidden-file predicate for the nav walkers (= open elsewhere). */
  hidden: Hidden<{ file: string }>;
}

/**
 * One stat-only scan + active-registry read, shared by every command.
 * Returns undefined (after notifying) when there is nothing to navigate.
 */
export async function loadSessions(ctx: ExtensionContext): Promise<SessionSet | undefined> {
  const files = await statScan(sessionDirFor(ctx), notifyError(ctx));
  if (files.length === 0) {
    ctx.ui.notify(MSG.noSessions, "error");
    return undefined;
  }
  const elsewhere = await activeElsewhere();
  return {
    files,
    currentFile: currentSessionFile(ctx),
    elsewhere,
    hidden: async (f) => elsewhere.has(f.file),
  };
}

/** Switch to a session file and announce it in the new session. */
export async function switchTo(
  ctx: ExtensionCommandContext,
  target: StatResult,
  announce: (label: string) => string = MSG.resumed,
): Promise<{ cancelled: boolean }> {
  const meta = await readSessionMeta(target.file, target);
  const label = truncate(sessionLabel(meta), LABEL_MAX);
  return ctx.switchSession(target.file, {
    withSession: async (newCtx) => {
      // Position lives only in this transient notice — no persistent footer
      // status line (it cost a whole extra footer row for the entire session).
      newCtx.ui.notify(announce(label), "info");
    },
  });
}
