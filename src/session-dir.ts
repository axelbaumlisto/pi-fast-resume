/**
 * Resolve the pi session directory for a given cwd.
 *
 * Preferred: derive it from the current session file (authoritative —
 * survives changes to pi's internal path encoding). Fallback: mirror
 * pi's encoding of cwd → `--<path-with-dashes>--`.
 */

import { join, dirname } from "node:path";
import { getPiAgentDir } from "./pi-dir.ts";

export function getSessionDir(cwd: string, currentSessionFile?: string): string {
  if (currentSessionFile) return dirname(currentSessionFile);
  const resolved = cwd.replace(/^\//, "").replace(/[/\\:]/g, "-");
  return join(getPiAgentDir(), "sessions", `--${resolved}--`);
}
