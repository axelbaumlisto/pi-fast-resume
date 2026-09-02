/**
 * One-time migration of legacy subagent fork sessions.
 *
 * pi-subagents < 0.53 (2026-08-20) wrote forked child sessions loose in the
 * project sessions dir, so they show up in /resume and in every navigation
 * command. Since 0.53 the canonical location is
 * `<parent-basename>/forks/<file>.jsonl` (nested under the parent's session
 * tree, invisible to top-level listings, removed together with the tree by
 * /rds).
 *
 * A loose file is a subagent fork when ALL hold:
 *   1. it was created before the fix (filename timestamp < LEGACY_CUTOFF);
 *   2. its header carries `parentSession`;
 *   3. it contains the delegated-subagent task prompt;
 *   4. after the LAST task prompt there is no human user message — only
 *      orchestrator follow-ups (`Task:`, `Mid-run steering…`, attachments).
 *
 * (4) is essential: a manual /fork of a session whose history contains a
 * subagent task inherits the marker text but then continues with the user's
 * own messages. Such sessions must never be touched.
 *
 * After one run nothing is left to scan (only legacy manual forks, which are
 * re-verified — a small, non-growing set), so navigation stays stat-only.
 */

import { open, rename, mkdir, access } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { join, dirname, basename } from "node:path";
import type { StatResult } from "./scanner.ts";

const HEAD_BYTES = 2048;
const TASK_MARKER = "You are a delegated subagent";
/** User-role messages a subagent orchestrator injects (not a human). */
const ORCHESTRATOR_PREFIXES = ["Task:", "Mid-run steering", "<file ", "<attachment"];
/** pi-subagents 0.53.0 release: forks created on/after this are already nested. */
export const LEGACY_CUTOFF = "2026-08-20";

async function readHead(file: string, size: number): Promise<string> {
  const fh = await open(file, "r");
  try {
    const len = Math.min(HEAD_BYTES, size);
    const buf = Buffer.alloc(len);
    const { bytesRead } = await fh.read(buf, 0, len, 0);
    return buf.subarray(0, bytesRead).toString("utf8");
  } finally {
    await fh.close();
  }
}

/** Parent session path from the header line, or undefined if not a fork. */
async function parentOf(ref: StatResult): Promise<string | undefined> {
  if (ref.size === 0) return undefined;
  let head: string;
  try {
    head = await readHead(ref.file, ref.size);
  } catch {
    return undefined;
  }
  const firstLine = head.split("\n", 1)[0] ?? "";
  if (!firstLine.includes('"parentSession"')) return undefined;
  try {
    const parent = JSON.parse(firstLine)?.parentSession;
    return typeof parent === "string" && parent ? parent : undefined;
  } catch {
    return undefined;
  }
}

/** Text of a user-role message line, or undefined if it is not one. */
function userText(line: string): string | undefined {
  if (!line.includes('"role":"user"')) return undefined;
  try {
    const msg = JSON.parse(line)?.message;
    if (msg?.role !== "user" || !Array.isArray(msg.content)) return undefined;
    return msg.content
      .filter((b: any) => b?.type === "text" && typeof b.text === "string")
      .map((b: any) => b.text)
      .join("")
      .trimStart();
  } catch {
    return undefined;
  }
}

const isOrchestrator = (text: string): boolean => ORCHESTRATOR_PREFIXES.some((p) => text.startsWith(p));

/**
 * Single streamed pass: was a task prompt seen, and did a human write
 * anything after the last one? Never buffers the file.
 */
async function isSubagentChild(file: string): Promise<boolean> {
  let markerSeen = false;
  let humanAfter = false;
  try {
    const rl = createInterface({
      input: createReadStream(file, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      if (line.includes(TASK_MARKER)) {
        markerSeen = true;
        humanAfter = false;
        continue;
      }
      if (!markerSeen || humanAfter) continue;
      const text = userText(line);
      if (text && !isOrchestrator(text)) humanAfter = true;
    }
  } catch {
    return false;
  }
  return markerSeen && !humanAfter;
}

export interface LegacyFork {
  file: string;
  target: string;
}

/**
 * Canonical nested location for a fork: next to the parent's session tree,
 * inside the child's own sessions dir.
 */
export function forkTarget(file: string, parentSession: string): string {
  return join(dirname(file), basename(parentSession, ".jsonl"), "forks", basename(file));
}

/** Created before the pi-subagents fix? (ISO timestamp prefix sorts lexically.) */
export function isLegacyName(file: string): boolean {
  return basename(file) < LEGACY_CUTOFF;
}

/** Find loose subagent fork sessions among `files`, skipping `skip` paths. */
export async function findLegacyForks(files: StatResult[], skip: Set<string> = new Set()): Promise<LegacyFork[]> {
  const out: LegacyFork[] = [];
  for (const ref of files) {
    if (skip.has(ref.file) || !isLegacyName(ref.file)) continue;
    const parent = await parentOf(ref);
    if (!parent) continue;
    if (!(await isSubagentChild(ref.file))) continue;
    out.push({ file: ref.file, target: forkTarget(ref.file, parent) });
  }
  return out;
}

/** Rename each fork into place. Existing targets are never overwritten. Returns moved count. */
export async function migrateLegacyForks(forks: LegacyFork[]): Promise<number> {
  let moved = 0;
  for (const { file, target } of forks) {
    try {
      await access(target);
      continue; // already there — leave both untouched, never clobber
    } catch {}
    try {
      await mkdir(dirname(target), { recursive: true });
      await rename(file, target);
      moved++;
    } catch {}
  }
  return moved;
}
