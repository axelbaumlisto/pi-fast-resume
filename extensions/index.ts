/**
 * pi-fast-resume — fast session resume without reading all .jsonl files.
 *
 * Commands:
 *   /r1 .. /r2       — instantly switch to the N-th most recent session
 *                      (stat-only; /r1 = latest, /r2 = 2nd, current excluded)
 *   pi --r N         — same as /rN but at startup (pi --r 1 = resume latest)
 *   pi --r1 .. --r2  — boolean form of the same (pi --r1 = resume latest)
 *   pi --rn          — alias for --r1
 *   /rn / /rp        — step to the next (older) / previous (newer) session
 *                      relative to the current one (by creation time)
 *   /rs              — paginated session picker (last 20, "Load more", tier filter)
 *   /rs set page N   — set page size (1-50)
 *   /rs set days N   — set maxDays filter (0-30, 0 = no limit)
 *   /rds             — delete all subagent session trees for the current project
 *                      (asks for confirmation; top-level sessions untouched)
 *
 * All navigation skips sessions currently open in another live pi process
 * (src/active.ts). At startup, legacy subagent fork sessions left loose by
 * pi-subagents < 0.53 are moved once into `<parent>/forks/` (src/migrate.ts),
 * so afterwards nothing needs filtering and every command stays stat-only.
 *
 * Layout: src/* are pure modules (no pi dependency, unit-tested);
 * src/ext/* glue them to the pi API, one file per concern.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerResumeCommands } from "../src/ext/resume.ts";
import { registerPicker } from "../src/ext/picker-command.ts";
import { registerRds } from "../src/ext/rds.ts";
import { registerStartup } from "../src/ext/startup.ts";

export default function (pi: ExtensionAPI) {
  registerResumeCommands(pi);
  registerPicker(pi);
  registerRds(pi);
  registerStartup(pi);
}
