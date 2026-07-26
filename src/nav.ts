/**
 * Pure session-navigation logic: ranked resume (/r1../rN, --r) and
 * step navigation (/rn, /rp). No pi SDK dependency.
 */

export interface FileRef {
  file: string;
}

/**
 * Rank-th most recent session, current excluded (rank 1 = latest).
 * Returns the target or undefined, plus how many candidates exist.
 */
export function rankTarget<T extends FileRef>(
  files: T[],
  currentFile: string | undefined,
  rank: number,
): { target?: T; othersCount: number } {
  const others = files.filter((f) => f.file !== currentFile);
  return { target: others[rank - 1], othersCount: others.length };
}

/**
 * Step relative to the current session in the mtime-sorted list.
 * dir = 1 → older, dir = -1 → newer. An unsaved current session
 * (not in the list) is treated as the newest.
 */
export function navTarget<T extends FileRef>(
  files: T[],
  currentFile: string | undefined,
  dir: 1 | -1,
): { target?: T; pos: number; total: number } {
  const idx = files.findIndex((f) => f.file === currentFile);
  const target = idx === -1 ? (dir === 1 ? files[0] : undefined) : files[idx + dir];
  const pos = target ? files.indexOf(target) + 1 : 0;
  return { target, pos, total: files.length };
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
