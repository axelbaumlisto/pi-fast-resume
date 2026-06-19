/**
 * Config management. Stores user prefs in ~/.pi/agent/extensions/pi-fast-resume/config.json.
 * Creates defaults at runtime — nothing shipped in the package.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const CONFIG_DIR = join(
  process.env.PI_CODING_AGENT_DIR || join(process.env.HOME || "~", ".pi", "agent"),
  "extensions",
  "pi-fast-resume",
);
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

export interface Config {
  pageSize: number;
  maxDays: number;
}

const DEFAULTS: Config = { pageSize: 20, maxDays: 7 };
const MIN_PAGE = 1;
const MAX_PAGE = 50;
const MIN_DAYS = 0;
const MAX_DAYS = 30;

export function clampPage(n: number): number {
  return Math.min(MAX_PAGE, Math.max(MIN_PAGE, n));
}

export function clampDays(n: number): number {
  return Math.min(MAX_DAYS, Math.max(MIN_DAYS, n));
}

export function loadConfig(): Config {
  try {
    if (existsSync(CONFIG_PATH)) {
      const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
      return {
        pageSize: clampPage(Number(raw.pageSize) || DEFAULTS.pageSize),
        maxDays: clampDays(Number(raw.maxDays) || DEFAULTS.maxDays),
      };
    }
  } catch {}
  return { ...DEFAULTS };
}

export function saveConfig(cfg: Config): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n");
}
