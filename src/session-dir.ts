/**
 * Resolve the pi session directory for a given cwd.
 * Mirrors pi's internal encoding: --<path-with-dashes>--
 */

import { join } from "node:path";

export function getSessionDir(cwd: string): string {
  const resolved = cwd.replace(/^\//, "").replace(/[/\\:]/g, "-");
  return join(
    process.env.PI_CODING_AGENT_DIR || join(process.env.HOME || "~", ".pi", "agent"),
    "sessions",
    `--${resolved}--`,
  );
}
