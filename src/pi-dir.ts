/**
 * Single source of truth for the pi agent base directory.
 * Mirrors pi's own resolution: $PI_CODING_AGENT_DIR or ~/.pi/agent.
 */

import { join } from "node:path";
import { homedir } from "node:os";

export function getPiAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR || join(process.env.HOME || homedir(), ".pi", "agent");
}
