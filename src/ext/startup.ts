/**
 * Startup hooks: active-session registry, `pi -c` collision guard and the
 * one-off legacy fork migration.
 *
 * Resuming at startup is pi's own job: `pi -c` opens the most recent session
 * (stat-only, one init) and `pi --session <id>` opens a specific one. pi
 * creates the session BEFORE extensions load, so an extension cannot choose
 * it — it can only react. The one thing `pi -c` cannot know is that the
 * session it picked is already open in another pi; we detect that from the
 * shared registry and hop to the most recent free session instead.
 */

import type { ExtensionAPI, ExtensionContext, SessionStartEvent } from "@earendil-works/pi-coding-agent";
import { statScan } from "../scanner.ts";
import { markActive, unmarkActive, activeElsewhere } from "../active.ts";
import { findLegacyForks, migrateLegacyForks } from "../migrate.ts";
import { currentSessionFile, sessionDirFor } from "./context.ts";
import { MSG } from "./messages.ts";

/** Upper bound on waiting for the provider refresh before switching anyway. */
const REFRESH_WAIT_MAX_MS = 15_000;

/** Was pi started with --continue / -c? (pi's own flag; not exposed via getFlag.) */
export function startedWithContinue(argv: readonly string[] = process.argv): boolean {
  return argv.includes("-c") || argv.includes("--continue");
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

/**
 * `pi -c` landed in a session another pi already holds → hop to the most
 * recent free one (/r1 skips busy sessions). Only for -c: with --session the
 * user asked for that exact file.
 */
async function hopIfBusy(pi: ExtensionAPI, ctx: ExtensionContext, busy: Set<string>): Promise<void> {
  const current = currentSessionFile(ctx);
  if (!current || !busy.has(current) || !ctx.hasUI) return;
  ctx.ui.notify(MSG.continueBusy, "info");
  // session_start only gets a plain ExtensionContext (no switchSession), so
  // dispatch our own slash command to run with a command context. Switching
  // while a provider refresh is in flight aborts it and crashes pi, so let
  // the refresh finish first.
  await Promise.race([
    ctx.modelRegistry.refresh().catch(() => {}),
    new Promise((r) => setTimeout(r, REFRESH_WAIT_MAX_MS)),
  ]);
  pi.sendUserMessage("/r1", { expandPromptTemplates: true });
}

export function registerStartup(pi: ExtensionAPI): void {
  pi.on("session_start", async (event: SessionStartEvent, ctx) => {
    // Who else holds what — read BEFORE we register ourselves.
    const busy = event.reason === "startup" && startedWithContinue() ? await activeElsewhere() : undefined;
    // Advertise which session this pi holds so other instances skip it.
    await markActive(currentSessionFile(ctx));
    if (event.reason !== "startup") return;
    void migrateForksInBackground(ctx).catch(() => {});
    if (busy) await hopIfBusy(pi, ctx, busy);
  });

  // Fires on switch (followed by session_start) and on exit.
  pi.on("session_shutdown", async () => {
    await unmarkActive();
  });
}
