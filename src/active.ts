/**
 * Registry of sessions currently open in live pi processes on this machine.
 *
 * Every pi instance that loads this extension writes
 * `<pi-agent-dir>/extensions/pi-fast-resume/active/<pid>.json` = { file }
 * on session_start and removes it on session_shutdown. Readers skip records
 * whose pid is dead (crash / kill -9), so stale files are harmless and are
 * cleaned up opportunistically.
 */

import { readdir, readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { execFile } from "node:child_process";
import { basename, join } from "node:path";
import { getPiAgentDir } from "./pi-dir.ts";

const activeDir = (): string => join(getPiAgentDir(), "extensions", "pi-fast-resume", "active");
const recordPath = (pid: number): string => join(activeDir(), `${pid}.json`);

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    // EPERM = exists but not ours; still alive.
    return err?.code === "EPERM";
  }
}

/**
 * `ps` command names for the given pids (one call). Empty map when `ps` is
 * unavailable (Windows, minimal containers). Names are compared like-for-like
 * — whatever `ps` reports for our own pid at write time vs. now — so script
 * launchers (`pi` via `#!/usr/bin/env node`) and comm truncation don't matter.
 */
async function psNames(pids: number[]): Promise<Map<number, string>> {
  const names = new Map<number, string>();
  if (pids.length === 0 || process.platform === "win32") return names;
  const out = await new Promise<string>((resolve) =>
    execFile("ps", ["-o", "pid=,comm=", "-p", pids.join(",")], (err, stdout) => resolve(err ? "" : stdout)),
  );
  for (const line of out.split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(.*)$/);
    if (m) names.set(Number(m[1]), basename(m[2]!.trim()));
  }
  return names;
}

/**
 * Guard against pid reuse after a crash: a stale record whose pid was later
 * handed to an unrelated process must not hide a session forever. Records
 * carry the `ps` name seen at write time; a live pid whose current name
 * differs is treated as stale. Returns pids that pass (or cannot be checked).
 */
async function verifyExecutables(expected: Map<number, string>): Promise<Set<number>> {
  const current = await psNames([...expected.keys()]);
  if (current.size === 0) return new Set(expected.keys()); // no ps — trust liveness
  const ok = new Set<number>();
  for (const [pid, exe] of expected) {
    const now = current.get(pid);
    if (now === undefined || now === exe) ok.add(pid);
  }
  return ok;
}

/** Record that this process has `file` open. No-op for unsaved sessions. */
export async function markActive(file: string | undefined, pid = process.pid): Promise<void> {
  if (!file) {
    await unmarkActive(pid);
    return;
  }
  try {
    const exe = (await psNames([pid])).get(pid);
    await mkdir(activeDir(), { recursive: true });
    await writeFile(recordPath(pid), JSON.stringify(exe ? { file, exe } : { file }));
  } catch {}
}

/** Remove this process's record (session closed / pi exiting). */
export async function unmarkActive(pid = process.pid): Promise<void> {
  try {
    await unlink(recordPath(pid));
  } catch {}
}

/**
 * Session files held open by OTHER live pi processes. Stale records (dead
 * pid, or pid reused by a different executable) are deleted as a side effect.
 */
export async function activeElsewhere(selfPid = process.pid): Promise<Set<string>> {
  const result = new Set<string>();
  let names: string[];
  try {
    names = await readdir(activeDir());
  } catch {
    return result;
  }

  const live = new Map<number, { path: string; file: string; exe?: string }>();
  await Promise.all(
    names.map(async (name) => {
      const pid = parseInt(name, 10);
      if (!name.endsWith(".json") || isNaN(pid) || pid === selfPid) return;
      const path = join(activeDir(), name);
      if (!pidAlive(pid)) {
        await unlink(path).catch(() => {});
        return;
      }
      try {
        const rec = JSON.parse(await readFile(path, "utf8"));
        if (typeof rec?.file === "string") {
          live.set(pid, { path, file: rec.file, exe: typeof rec.exe === "string" ? rec.exe : undefined });
        }
      } catch {}
    }),
  );

  // Records with an exe name get verified; legacy records without one are trusted.
  const toVerify = new Map<number, string>();
  for (const [pid, rec] of live) if (rec.exe) toVerify.set(pid, rec.exe);
  const verified = await verifyExecutables(toVerify);

  for (const [pid, rec] of live) {
    if (rec.exe && !verified.has(pid)) {
      await unlink(rec.path).catch(() => {});
      continue;
    }
    result.add(rec.file);
  }
  return result;
}
