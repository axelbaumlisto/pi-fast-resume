/**
 * Pure session-navigation logic: ranked resume (/r1../rN, --r) and
 * step navigation (/rn, /rp). No pi SDK dependency.
 *
 * All walkers take an async `hidden` predicate and skip files it rejects.
 * The predicate is evaluated lazily, only for files actually visited, so a
 * costly check (e.g. scanning a fork file) is paid per candidate, not per
 * directory.
 */

export interface FileRef {
  file: string;
}

export type Hidden<T extends FileRef> = (f: T) => Promise<boolean>;

const never = async () => false;

// pi session filenames: `<ISO timestamp with '-' instead of ':' and '.'>_<uuid>.jsonl`
// e.g. 2026-08-10T14-31-05-921Z_019fec15-....jsonl
const FILENAME_TS_RE = /(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z_/;

/**
 * Session creation time from the filename (immutable), or undefined if the
 * name doesn't follow pi's pattern.
 */
export function createdAtFromName(file: string): number | undefined {
  const base = file.slice(file.lastIndexOf("/") + 1);
  const m = FILENAME_TS_RE.exec(base);
  if (!m) return undefined;
  const t = Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`);
  return isNaN(t) ? undefined : t;
}

/**
 * Stable order for step navigation: newest-created first.
 *
 * mtime is NOT stable for walking: resuming a session makes extensions append
 * entries (e.g. state on session_start), which bumps its mtime to "now" and
 * reshuffles the list, so /rn, /rn, /rn ping-pongs between two sessions.
 * Creation time never changes, so a walk over it is predictable. Files
 * without a parseable timestamp fall back to mtime.
 */
export function sortByCreated<T extends FileRef & { mtime: Date }>(files: T[]): T[] {
  const key = (f: T) => createdAtFromName(f.file) ?? f.mtime.getTime();
  return [...files].sort((a, b) => key(b) - key(a));
}

/**
 * Rank-th most recent visible session, current excluded (rank 1 = latest).
 * Returns the target or undefined, plus how many visible candidates were seen.
 */
export async function rankTarget<T extends FileRef>(
  files: T[],
  currentFile: string | undefined,
  rank: number,
  hidden: Hidden<T> = never,
): Promise<{ target?: T; othersCount: number }> {
  let seen = 0;
  for (const f of files) {
    if (f.file === currentFile || (await hidden(f))) continue;
    seen++;
    if (seen === rank) return { target: f, othersCount: seen };
  }
  return { target: undefined, othersCount: seen };
}

/**
 * Step relative to the current session in the given list (callers pass
 * sortByCreated() output for a stable walk), skipping hidden files. dir = 1 → older, dir = -1 → newer. An unsaved current session
 * (not in the list) is treated as the newest. `pos`/`total` are raw list
 * indices (1-based) for the on-screen indicator.
 */
export async function navTarget<T extends FileRef>(
  files: T[],
  currentFile: string | undefined,
  dir: 1 | -1,
  hidden: Hidden<T> = never,
): Promise<{ target?: T; pos: number; total: number }> {
  const idx = files.findIndex((f) => f.file === currentFile);
  let i = idx === -1 ? (dir === 1 ? 0 : -1) : idx + dir;
  while (i >= 0 && i < files.length) {
    const f = files[i]!;
    if (!(await hidden(f))) return { target: f, pos: i + 1, total: files.length };
    i += dir;
  }
  return { target: undefined, pos: 0, total: files.length };
}

/** Keep only visible files (order preserved). */
export async function filterVisible<T extends FileRef>(files: T[], hidden: Hidden<T>): Promise<T[]> {
  const out: T[] = [];
  for (const f of files) if (!(await hidden(f))) out.push(f);
  return out;
}

/**
 * Parse the --r startup flag value.
 * Returns a rank, an error message, or undefined when the flag is unset.
 */
export function parseRankFlag(
  raw: unknown,
  maxRank: number,
): { rank: number } | { error: string } | undefined {
  if (raw === undefined || raw === null || raw === false) return undefined;
  const rank = parseInt(String(raw), 10);
  if (isNaN(rank) || rank < 1 || rank > maxRank) {
    return { error: `--r expects a number 1-${maxRank} (got "${raw}")` };
  }
  return { rank };
}
