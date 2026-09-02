/**
 * Hidden-session detection: sessions that should never show up in ranked /
 * step / picker navigation.
 *
 * 1. Subagent fork sessions. pi-subagents < 0.53 wrote forked child sessions
 *    loose in the project sessions dir (they carry `parentSession` in the
 *    header, exactly like a manual /fork). The child is identifiable by the
 *    task prompt it received ("You are a delegated subagent ...") or by the
 *    session name pi-subagents assigns ("subagent-<agent>-<id>-<n>").
 *    Only files WITH `parentSession` are ever scanned; verdicts are cached on
 *    disk keyed by (mtime, size) so each file is scanned once, ever.
 *
 * 2. Sessions currently open in another live pi process (see active.ts).
 */

import { open, readFile, writeFile, mkdir } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { join } from "node:path";
import { getPiAgentDir } from "./pi-dir.ts";

export interface StatRef {
  file: string;
  mtime: Date;
  size: number;
}

const HEAD_BYTES = 2048;
const TAIL_BYTES = 4096;
const SUBAGENT_TASK_MARKER = "You are a delegated subagent";
const SUBAGENT_NAME_MARKER = '"name":"subagent-';

// Resolved lazily so PI_CODING_AGENT_DIR set at runtime (tests) is honoured.
const cacheDir = (): string => join(getPiAgentDir(), "extensions", "pi-fast-resume");
const cachePath = (): string => join(cacheDir(), "fork-cache.json");

type CacheEntry = { m: number; s: number; h: boolean };
type Cache = Record<string, CacheEntry>;

let cache: Cache | undefined;
let dirty = false;

async function loadCache(): Promise<Cache> {
  if (cache) return cache;
  try {
    cache = JSON.parse(await readFile(cachePath(), "utf8")) as Cache;
  } catch {
    cache = {};
  }
  return cache;
}

async function flushCache(): Promise<void> {
  if (!dirty || !cache) return;
  dirty = false;
  try {
    await mkdir(cacheDir(), { recursive: true });
    await writeFile(cachePath(), JSON.stringify(cache));
  } catch {}
}

/** Test-only: reset in-memory cache state. */
export function clearForkCache(): void {
  cache = undefined;
  dirty = false;
}

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

/** Does the file contain the marker anywhere? Streams; never buffers the whole file. */
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

/** Uncached verdict: is this a subagent fork session? */
async function detectSubagentFork(ref: StatRef): Promise<boolean> {
  let head: string;
  try {
    head = await readSlice(ref.file, 0, Math.min(HEAD_BYTES, ref.size));
  } catch {
    return false;
  }
  const firstLine = head.split("\n", 1)[0] ?? "";
  if (!firstLine.includes('"parentSession"')) return false;

  // Cheap: pi-subagents names the child session; the rename usually sits in the tail.
  if (ref.size > 0) {
    try {
      const len = Math.min(TAIL_BYTES, ref.size);
      const tail = await readSlice(ref.file, ref.size - len, len);
      if (tail.includes(SUBAGENT_NAME_MARKER)) return true;
    } catch {}
  }

  // Full streamed scan for the delegated-task prompt (once per file, then cached).
  return streamContains(ref.file, SUBAGENT_TASK_MARKER);
}

/** Cached: is this a subagent fork session that should be hidden? */
export async function isSubagentFork(ref: StatRef): Promise<boolean> {
  const c = await loadCache();
  const hit = c[ref.file];
  const m = ref.mtime.getTime();
  if (hit && hit.m === m && hit.s === ref.size) return hit.h;

  const h = await detectSubagentFork(ref);
  c[ref.file] = { m, s: ref.size, h };
  dirty = true;
  await flushCache();
  return h;
}

/**
 * Drop cache entries for files under `sessionDir` that no longer exist.
 * Entries for other project dirs are untouched.
 */
export async function pruneForkCache(sessionDir: string, present: Set<string>): Promise<void> {
  const c = await loadCache();
  const prefix = sessionDir.endsWith("/") ? sessionDir : sessionDir + "/";
  for (const key of Object.keys(c)) {
    if (key.startsWith(prefix) && !present.has(key)) {
      delete c[key];
      dirty = true;
    }
  }
  await flushCache();
}
