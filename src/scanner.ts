/**
 * Fast session scanner using stat + lazy header parse.
 *
 * Key principle: never read full .jsonl files.
 * - stat() for mtime/size sorting
 * - First ~50 lines for header, session_info, first user message
 */

import { readdir, stat, rm, open } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";

export interface SessionEntry {
  file: string;
  mtime: Date;
  size: number;
  id?: string;
  timestamp?: string;
  cwd?: string;
  name?: string;
  firstMessage?: string;
}

export interface StatResult {
  file: string;
  mtime: Date;
  size: number;
}

/**
 * Fast stat-only scan: readdir + stat, sorted by mtime desc.
 * No file content is read.
 *
 * A missing directory (no sessions yet) returns []. Other readdir errors
 * (permissions, I/O) are surfaced via onError so callers can distinguish
 * "no sessions" from "could not read sessions".
 */
export async function statScan(
  sessionDir: string,
  onError?: (message: string) => void,
): Promise<StatResult[]> {
  let entries: string[];
  try {
    entries = await readdir(sessionDir);
  } catch (err: any) {
    if (err?.code !== "ENOENT" && onError) {
      onError(`Cannot read sessions dir: ${err?.message ?? err}`);
    }
    return [];
  }

  const jsonlFiles = entries.filter((f) => f.endsWith(".jsonl"));

  const results = await Promise.all(
    jsonlFiles.map(async (f) => {
      const fullPath = join(sessionDir, f);
      try {
        const s = await stat(fullPath);
        if (!s.isFile()) return null;
        return { file: fullPath, mtime: s.mtime, size: s.size };
      } catch {
        return null;
      }
    }),
  );

  const valid = results.filter((r): r is StatResult => r !== null);
  valid.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  return valid;
}

// Metadata cache keyed by file path, validated by (mtime, size). A session
// file only changes by appending (mtime+size change), so a hit is always
// fresh. Keeps /rs "Load more" and repeated opens I/O-free for known files.
const metaCache = new Map<string, { mtimeMs: number; size: number; entry: SessionEntry }>();

/** Test-only: clear the metadata cache. */
export function clearMetaCache(): void {
  metaCache.clear();
}

/**
 * Read session metadata from first ~50 lines of a .jsonl file.
 * Caller provides mtime/size from prior stat() to avoid double-stat.
 * Results are cached by (file, mtime, size).
 */
export async function readSessionMeta(
  filePath: string,
  known?: { mtime: Date; size: number },
): Promise<SessionEntry> {
  const entry: SessionEntry = {
    file: filePath,
    mtime: known?.mtime ?? new Date(0),
    size: known?.size ?? 0,
  };

  if (!known) {
    try {
      const s = await stat(filePath);
      entry.mtime = s.mtime;
      entry.size = s.size;
    } catch {}
  }

  const cached = metaCache.get(filePath);
  if (cached && cached.mtimeMs === entry.mtime.getTime() && cached.size === entry.size) {
    // Return a copy with the caller-provided mtime/size (identical anyway).
    return { ...cached.entry, mtime: entry.mtime, size: entry.size };
  }

  const MAX_LINES = 50;
  let lineCount = 0;

  try {
    const rl = createInterface({
      input: createReadStream(filePath, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      lineCount++;
      if (lineCount > MAX_LINES) break;

      try {
        const parsed = JSON.parse(line);

        if (parsed.type === "session" && !entry.id) {
          entry.id = parsed.id;
          entry.timestamp = parsed.timestamp;
          entry.cwd = parsed.cwd;
          continue;
        }

        if (parsed.type === "session_info" && parsed.name) {
          entry.name = parsed.name.trim();
          continue;
        }

        if (!entry.firstMessage && parsed.type === "message") {
          const msg = parsed.message;
          if (msg?.role === "user" && Array.isArray(msg.content)) {
            for (const block of msg.content) {
              if (block.type === "text" && block.text) {
                entry.firstMessage = block.text.slice(0, 80).replace(/\n/g, " ");
                break;
              }
            }
          }
        }
      } catch {
        // skip unparseable lines
      }

      if (entry.id && entry.firstMessage) break;
    }

    rl.close();
  } catch {}

  // Session renames APPEND a session_info entry at the end of the file, so
  // a name found in the tail overrides whatever the head scan saw.
  const tailName = await readTailName(filePath, entry.size);
  if (tailName) entry.name = tailName;

  metaCache.set(filePath, { mtimeMs: entry.mtime.getTime(), size: entry.size, entry: { ...entry } });
  return entry;
}

// How many bytes of the file tail to inspect for a trailing session_info.
const TAIL_BYTES = 4096;

/**
 * Read the last TAIL_BYTES of a session file and return the name from the
 * LAST parseable session_info line, if any. Cheap: one small read.
 */
async function readTailName(filePath: string, size: number): Promise<string | undefined> {
  if (size <= 0) return undefined;

  const readLen = Math.min(TAIL_BYTES, size);
  const position = size - readLen;

  let text: string;
  try {
    const fh = await open(filePath, "r");
    try {
      const buf = Buffer.alloc(readLen);
      const { bytesRead } = await fh.read(buf, 0, readLen, position);
      text = buf.subarray(0, bytesRead).toString("utf8");
    } finally {
      await fh.close();
    }
  } catch {
    return undefined;
  }

  const lines = text.split("\n");
  // When reading mid-file, the first line is likely a partial record — skip it.
  const firstValid = position > 0 ? 1 : 0;
  for (let i = lines.length - 1; i >= firstValid; i--) {
    const line = lines[i]?.trim();
    if (!line) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed.type === "session_info" && typeof parsed.name === "string" && parsed.name.trim()) {
        return parsed.name.trim();
      }
    } catch {
      // partial or non-JSON line — keep walking up
    }
  }
  return undefined;
}

/**
 * Scan a page of sessions with metadata.
 * Pass known mtime/size from statScan to avoid double stat().
 */
export async function scanPage(
  sessionDir: string,
  offset: number,
  limit: number,
  maxDays?: number,
  excludeFile?: string,
  onError?: (message: string) => void,
): Promise<{ entries: SessionEntry[]; total: number; hasMore: boolean }> {
  const all = await statScan(sessionDir, onError);

  let filtered = all;
  if (maxDays && maxDays > 0) {
    const cutoff = Date.now() - maxDays * 86400_000;
    filtered = all.filter((f) => f.mtime.getTime() > cutoff);
  }

  if (excludeFile) {
    filtered = filtered.filter((f) => f.file !== excludeFile);
  }

  const total = filtered.length;
  const page = filtered.slice(offset, offset + limit);
  const hasMore = offset + limit < total;

  const entries = await Promise.all(page.map((f) => readSessionMeta(f.file, f)));

  return { entries, total, hasMore };
}

// A session-tree subdir is named exactly like a top-level session file, minus
// the `.jsonl` suffix: `<ISO-timestamp>_<uuid>`. pi nests every subagent run
// (`<runId>/run-N/session.jsonl`) under such a directory. We match that shape
// so we never touch unrelated folders.
const SESSION_TREE_RE = /^\d{4}-\d{2}-\d{2}T[\dZ.-]+_[0-9a-f-]{8,}$/i;

export interface SubagentTree {
  dir: string; // absolute path to the <timestamp>_<uuid> subdir
  name: string; // the directory basename
  runs: number; // count of run-*/session.jsonl files under it
  bytes: number; // total size of the tree on disk
}

/**
 * Find subagent session trees for a project dir.
 *
 * pi stores every subagent run under a subdirectory named like a top-level
 * session (`<timestamp>_<uuid>/`), containing `<runId>/run-N/session.jsonl`.
 * These accumulate fast and bloat the sessions folder. This scans ONLY the
 * given project dir (non-recursive at the top), returning each matching
 * subdir with its run count and on-disk size. Top-level `*.jsonl` session
 * files (the real user sessions) are never included.
 */
export async function scanSubagentTrees(sessionDir: string): Promise<SubagentTree[]> {
  let entries: string[];
  try {
    entries = await readdir(sessionDir, { withFileTypes: true }) as any;
  } catch {
    return [];
  }

  const dirs = (entries as unknown as { name: string; isDirectory: () => boolean }[])
    .filter((e) => e.isDirectory() && SESSION_TREE_RE.test(e.name))
    .map((e) => e.name);

  const trees = await Promise.all(
    dirs.map(async (name) => {
      const dir = join(sessionDir, name);
      const { runs, bytes } = await measureTree(dir);
      return { dir, name, runs, bytes };
    }),
  );

  // Newest first (by directory-name timestamp, which sorts lexicographically).
  trees.sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
  return trees;
}

/** Recursively count `session.jsonl` (run-N) files and total bytes under a dir. */
async function measureTree(dir: string): Promise<{ runs: number; bytes: number }> {
  let runs = 0;
  let bytes = 0;

  async function walk(d: string): Promise<void> {
    let items: { name: string; isDirectory: () => boolean; isFile: () => boolean }[];
    try {
      items = (await readdir(d, { withFileTypes: true })) as any;
    } catch {
      return;
    }
    for (const it of items) {
      const full = join(d, it.name);
      if (it.isDirectory()) {
        await walk(full);
      } else if (it.isFile()) {
        try {
          const s = await stat(full);
          bytes += s.size;
          if (it.name === "session.jsonl") runs++;
        } catch {}
      }
    }
  }

  await walk(dir);
  return { runs, bytes };
}

/**
 * Delete a list of subagent tree directories (recursively). Returns the count
 * successfully removed. Guards against deleting anything that isn't a
 * session-tree subdir under the given sessionDir.
 */
export async function deleteSubagentTrees(
  sessionDir: string,
  trees: SubagentTree[],
): Promise<number> {
  let removed = 0;
  for (const t of trees) {
    // Safety: the dir must live directly under sessionDir and match the shape.
    if (join(sessionDir, t.name) !== t.dir || !SESSION_TREE_RE.test(t.name)) {
      continue;
    }
    try {
      await rm(t.dir, { recursive: true, force: true });
      removed++;
    } catch {}
  }
  return removed;
}
