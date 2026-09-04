import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

// bin/pi-r.mjs must resolve exactly like the extension does.
const AGENT_DIR = join(tmpdir(), `pi-fast-resume-bin-${Date.now()}`);
process.env.PI_CODING_AGENT_DIR = AGENT_DIR;
const bin: any = await import("../bin/pi-r.mjs");
const { getSessionDir } = await import("../src/session-dir.ts");
const { statScan } = await import("../src/scanner.ts");
const { rankTarget } = await import("../src/nav.ts");

const CWD = "/Users/me/work/proj";
const DIR = getSessionDir(CWD);

function write(name: string, ageMs: number): string {
  const file = join(DIR, name);
  writeFileSync(file, JSON.stringify({ type: "session", version: 3, id: name, cwd: CWD }) + "\n");
  const t = new Date(Date.now() - ageMs);
  utimesSync(file, t, t);
  return file;
}

before(() => mkdirSync(DIR, { recursive: true }));
after(() => rmSync(AGENT_DIR, { recursive: true, force: true }));

describe("bin/pi-r parity with the extension", () => {
  it("sessionDirFor matches getSessionDir", () => {
    for (const cwd of [CWD, "/", "/a:b/c", "C:\\x\\y"]) {
      assert.equal(bin.sessionDirFor(cwd), getSessionDir(cwd));
    }
  });

  it("listSessions matches statScan order", async () => {
    const a = write("2026-01-01T00-00-00-000Z_a.jsonl", 3000_000);
    const b = write("2026-01-02T00-00-00-000Z_b.jsonl", 1000_000);
    const c = write("2026-01-03T00-00-00-000Z_c.jsonl", 2000_000);
    writeFileSync(join(DIR, "notes.txt"), "x");
    assert.deepEqual(bin.listSessions(DIR), [b, c, a]);
    assert.deepEqual(bin.listSessions(DIR), (await statScan(DIR)).map((f) => f.file));
    assert.deepEqual(bin.listSessions("/nonexistent-xyz"), []);
  });

  it("pickSession matches rankTarget (busy = hidden, no current)", async () => {
    const files = bin.listSessions(DIR) as string[];
    const busy = new Set([files[0]]);
    const refs = files.map((file) => ({ file }));
    for (const rank of [1, 2, 3]) {
      const expected = (await rankTarget(refs, undefined, rank, async (f) => busy.has(f.file))).target?.file;
      assert.equal(bin.pickSession(files, busy, rank), expected, `rank ${rank}`);
    }
  });

  it("parseArgs: leading integer is the rank, everything else passes through", () => {
    assert.deepEqual(bin.parseArgs([]), { rank: 1, rest: [] });
    assert.deepEqual(bin.parseArgs(["2"]), { rank: 2, rest: [] });
    assert.deepEqual(bin.parseArgs(["2", "-m", "x"]), { rank: 2, rest: ["-m", "x"] });
    assert.deepEqual(bin.parseArgs(["-m", "x"]), { rank: 1, rest: ["-m", "x"] });
    assert.deepEqual(bin.parseArgs(["0"]), { rank: 1, rest: ["0"] });
  });

  it("activeElsewhere reads the same registry", () => {
    const reg = join(AGENT_DIR, "extensions", "pi-fast-resume", "active");
    mkdirSync(reg, { recursive: true });
    writeFileSync(join(reg, `${process.pid}.json`), JSON.stringify({ file: "/s/mine.jsonl" }));
    writeFileSync(join(reg, "2000000000.json"), JSON.stringify({ file: "/s/dead.jsonl" }));
    const set = bin.activeElsewhere() as Set<string>;
    assert.equal(set.has("/s/mine.jsonl"), true); // bin has no "self" — every live record counts
    assert.equal(set.has("/s/dead.jsonl"), false);
    rmSync(reg, { recursive: true, force: true });
  });

  it("end-to-end: launches pi with --session <2nd newest> and passes args", () => {
    // Fake `pi` that echoes its argv.
    const fakeBin = join(AGENT_DIR, "fakepi.sh");
    writeFileSync(fakeBin, '#!/bin/sh\nprintf "%s\\n" "$@"\nexit 7\n', { mode: 0o755 });
    // Run from the repo dir: its session dir under the temp agent dir is empty → "starting new".
    const res = spawnSync(process.execPath, [join(process.cwd(), "bin", "pi-r.mjs"), "2", "--foo"], {
      cwd: process.cwd(),
      env: { ...process.env, PI_CODING_AGENT_DIR: AGENT_DIR, PI_BIN: fakeBin },
      encoding: "utf8",
    });
    assert.equal(res.status, 7);
    assert.match(res.stderr, /no eligible session #2/);
    assert.deepEqual(res.stdout.trim().split("\n"), ["--foo"]);
  });

  it("end-to-end: with sessions present passes --session", () => {
    const fakeBin = join(AGENT_DIR, "fakepi.sh");
    const realCwd = process.cwd();
    const dir = getSessionDir(realCwd);
    mkdirSync(dir, { recursive: true });
    const newest = join(dir, "2026-02-02T00-00-00-000Z_n.jsonl");
    const second = join(dir, "2026-02-01T00-00-00-000Z_s.jsonl");
    writeFileSync(second, "{}\n");
    writeFileSync(newest, "{}\n");
    const old = new Date(Date.now() - 100_000);
    utimesSync(second, old, old);
    const res = spawnSync(process.execPath, [join(realCwd, "bin", "pi-r.mjs"), "2", "-m", "x"], {
      cwd: realCwd,
      env: { ...process.env, PI_CODING_AGENT_DIR: AGENT_DIR, PI_BIN: fakeBin },
      encoding: "utf8",
    });
    assert.equal(res.status, 7);
    assert.deepEqual(res.stdout.trim().split("\n"), ["--session", second, "-m", "x"]);
  });
});
