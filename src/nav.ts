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
 * Step relative to the current session in the mtime-sorted list, skipping
 * hidden files. dir = 1 → older, dir = -1 → newer. An unsaved current session
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
