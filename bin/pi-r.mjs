#!/usr/bin/env node
/**
 * pi-r — launch pi directly in the N-th most recent session of the current
 * project, resolved BEFORE pi starts (one process start, no session switch).
 *
 *   pi-r          # latest session (same as pi-r 1)
 *   pi-r 2        # 2nd most recent
 *   pi-r 1 -m x   # extra args are passed through to pi
 *
 * Sessions open in another live pi are skipped. With no eligible session pi
 * starts normally. Zero dependencies: plain node, stat-only, mirrors
 * src/session-dir.ts and src/active.ts (see tests/bin.test.ts for parity).
 */

import { readdirSync, statSync, readFileSync, unlinkSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { join, basename } from "node:path";
import { homedir } from "node:os";

const agentDir = process.env.PI_CODING_AGENT_DIR || join(process.env.HOME || homedir(), ".pi", "agent");

export function sessionDirFor(cwd) {
  const resolved = cwd.replace(/^\//, "").replace(/[/\\:]/g, "-");
  return join(agentDir, "sessions", `--${resolved}--`);
}

/** *.jsonl in dir, newest first (stat-only). */
export function listSessions(dir) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const n of names) {
    if (!n.endsWith(".jsonl")) continue;
    const file = join(dir, n);
    try {
      const s = statSync(file);
      if (s.isFile()) out.push({ file, mtimeMs: s.mtimeMs });
    } catch {}
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs).map((e) => e.file);
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === "EPERM";
  }
}

function psNames(pids) {
  const names = new Map();
  if (pids.length === 0 || process.platform === "win32") return names;
  try {
    const out = execFileSync("ps", ["-o", "pid=,comm=", "-p", pids.join(",")], { encoding: "utf8" });
    for (const line of out.split("\n")) {
      const m = line.trim().match(/^(\d+)\s+(.*)$/);
      if (m) names.set(Number(m[1]), basename(m[2].trim()));
    }
  } catch {}
  return names;
}

/** Session files held by other live pi processes (same registry as the extension). */
export function activeElsewhere() {
  const dir = join(agentDir, "extensions", "pi-fast-resume", "active");
  const result = new Set();
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return result;
  }
  const live = [];
  for (const n of names) {
    const pid = parseInt(n, 10);
    if (!n.endsWith(".json") || isNaN(pid)) continue;
    const path = join(dir, n);
    if (!pidAlive(pid)) {
      try { unlinkSync(path); } catch {}
      continue;
    }
    try {
      const rec = JSON.parse(readFileSync(path, "utf8"));
      if (typeof rec?.file === "string") live.push({ pid, file: rec.file, exe: rec.exe });
    } catch {}
  }
  const current = psNames(live.filter((r) => r.exe).map((r) => r.pid));
  for (const r of live) {
    const now = current.get(r.pid);
    if (r.exe && now !== undefined && now !== r.exe) {
      try { unlinkSync(join(dir, `${r.pid}.json`)); } catch {}
      continue;
    }
    result.add(r.file);
  }
  return result;
}

/** Pick the rank-th session not held elsewhere. */
export function pickSession(files, busy, rank) {
  let seen = 0;
  for (const f of files) {
    if (busy.has(f)) continue;
    if (++seen === rank) return f;
  }
  return undefined;
}

/** Split argv into { rank, rest }. A leading positive integer is the rank. */
export function parseArgs(argv) {
  const [first, ...rest] = argv;
  if (first !== undefined && /^\d+$/.test(first) && Number(first) >= 1) {
    return { rank: Number(first), rest };
  }
  return { rank: 1, rest: argv };
}

function main() {
  const { rank, rest } = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  const target = pickSession(listSessions(sessionDirFor(cwd)), activeElsewhere(), rank);
  const args = target ? ["--session", target, ...rest] : rest;
  if (!target) process.stderr.write(`pi-r: no eligible session #${rank} for ${cwd} — starting new\n`);
  const res = spawnSync(process.env.PI_BIN || "pi", args, { stdio: "inherit" });
  if (res.error) {
    process.stderr.write(`pi-r: cannot start pi: ${res.error.message}\n`);
    process.exit(127);
  }
  process.exit(res.status ?? 1);
}

if (process.argv[1] && basename(process.argv[1]).startsWith("pi-r")) main();
