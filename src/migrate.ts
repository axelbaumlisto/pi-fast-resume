/**
 * One-time migration of legacy subagent fork sessions.
 *
 * pi-subagents < 0.53 wrote forked child sessions loose in the project
 * sessions dir, so they show up in /resume and in every navigation command.
 * Since 0.53 the canonical location is `<parent-basename>/forks/<file>.jsonl`
 * (nested under the parent's session tree, invisible to top-level listings,
 * removed together with the tree by /rds).
 *
 * This module finds loose files that (a) carry a `parentSession` header and
 * (b) contain the delegated-subagent task prompt or a `subagent-*` session
 * name, and renames them into the canonical location. Manual /fork sessions
 * have (a) but not (b) and are left alone. After one run there is nothing
 * left to scan, so navigation stays stat-only.
 */

import { open, rename, mkdir, access } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { join, dirname, basename } from "node:path";
import type { StatResult } from "./scanner.ts";

const HEAD_BYTES = 2048;
const TAIL_BYTES = 4096;
const TASK_MARKER = "You are a delegated subagent";
const NAME_MARKER = '"name":"subagent-';

async function readSlice(file: string, position: number, length: number): Promise<string> {
  const fh = await open(file, "r");
  try {
    const buf = Buffer.alloc(length);
    const { bytesRead } = await fh.read(buf, 0, length, position);
    return buf.subarray(0, bytesRead).toString("utf8");
  } finally {
    await fh.close();
  }
}

/** Streamed substring search; never buffers the whole file. */
function streamContains(file: string, marker: string): Promise<boolean> {
  return new Promise((resolve) => {
    const stream = createReadStream(file, { encoding: "utf8", highWaterMark: 1 << 20 });
    let carry = "";
    const keep = marker.length - 1;
    stream.on("data", (chunk) => {
      const text = carry + chunk;
      if (text.includes(marker)) {
        stream.destroy();
        resolve(true);
        return;
      }
      carry = text.slice(-keep);
    });
    stream.on("end", () => resolve(false));
    stream.on("error", () => resolve(false));
  });
}

/** Parent session path from the header line, or undefined if not a fork. */
async function parentOf(ref: StatResult): Promise<string | undefined> {
  if (ref.size === 0) return undefined;
  let head: string;
  try {
    head = await readSlice(ref.file, 0, Math.min(HEAD_BYTES, ref.size));
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

/** Is this fork a subagent child (vs. a manual /fork)? */
async function isSubagentChild(ref: StatResult): Promise<boolean> {
  try {
    const len = Math.min(TAIL_BYTES, ref.size);
    const tail = await readSlice(ref.file, ref.size - len, len);
    if (tail.includes(NAME_MARKER)) return true;
  } catch {}
  return streamContains(ref.file, TASK_MARKER);
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

/** Find loose subagent fork sessions among `files`, skipping `skip` paths. */
export async function findLegacyForks(files: StatResult[], skip: Set<string> = new Set()): Promise<LegacyFork[]> {
  const out: LegacyFork[] = [];
  for (const ref of files) {
    if (skip.has(ref.file)) continue;
    const parent = await parentOf(ref);
    if (!parent) continue;
    if (!(await isSubagentChild(ref))) continue;
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
