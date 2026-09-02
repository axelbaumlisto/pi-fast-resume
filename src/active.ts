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
import { join } from "node:path";
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

/** Record that this process has `file` open. No-op for unsaved sessions. */
export async function markActive(file: string | undefined, pid = process.pid): Promise<void> {
  if (!file) {
    await unmarkActive(pid);
    return;
  }
  try {
    await mkdir(activeDir(), { recursive: true });
    await writeFile(recordPath(pid), JSON.stringify({ file }));
  } catch {}
}

/** Remove this process's record (session closed / pi exiting). */
export async function unmarkActive(pid = process.pid): Promise<void> {
  try {
    await unlink(recordPath(pid));
  } catch {}
}

/**
 * Session files held open by OTHER live processes. Stale records (dead pid)
 * are deleted as a side effect.
 */
export async function activeElsewhere(selfPid = process.pid): Promise<Set<string>> {
  const result = new Set<string>();
  let names: string[];
  try {
    names = await readdir(activeDir());
  } catch {
    return result;
  }
  await Promise.all(
    names.map(async (name) => {
      const pid = parseInt(name, 10);
      if (!name.endsWith(".json") || isNaN(pid) || pid === selfPid) return;
      const path = join(activeDir(), name);
      if (!pidAlive(pid)) {
        try {
          await unlink(path);
        } catch {}
        return;
      }
      try {
        const rec = JSON.parse(await readFile(path, "utf8"));
        if (typeof rec?.file === "string") result.add(rec.file);
      } catch {}
    }),
  );
  return result;
}
