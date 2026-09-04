/**
 * Interactive e2e: a real pi TUI driven through tmux. Requires `tmux` and
 * `pi` on PATH; skipped otherwise. Run: npm run test:tui
 */

import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, readFileSync, statSync, utimesSync } from "node:fs";
import { basename } from "node:path";
import { PiTui, tmuxAvailable, sleep, type Fixture } from "./harness.ts";
import { statScan } from "../../src/scanner.ts";

/** Fixtures other than `current`, newest mtime first (what /r1 ranks by). */
const byMtimeExcluding = (all: Fixture[], current: Fixture) =>
  all.filter((f) => f !== current).sort((a, b) => statSync(b.file).mtimeMs - statSync(a.file).mtimeMs);

const skip = !tmuxAvailable();

describe("TUI: step navigation and pi -c", { skip }, () => {
  const t = new PiTui(80, 30);
  let s: Fixture[];
  before(() => {
    // Creation order s1 < s2 < s3 < s4; mtimes match. s4 is newest.
    s = [1, 2, 3, 4].map((d) => t.session(d, `fixture session ${d}`));
    t.start(["-c"]);
  });
  after(() => t.stop());

  it("pi -c opens the most recent session", async () => {
    await t.waitForSession(s[3]!, 60_000);
  });

  it("/rn walks older: s4 → s3 → s2", async () => {
    await t.cmd("/rn"); await t.waitForSession(s[2]!);
    await t.cmd("/rn"); await t.waitForSession(s[1]!);
  });

  it("/rp walks newer: s2 → s3 → s4, then edge notice", async () => {
    await t.cmd("/rp"); await t.waitForSession(s[2]!);
    await t.cmd("/rp"); await t.waitForSession(s[3]!);
    await t.cmd("/rp"); await t.waitForText(/Already at the newest session/);
    assert.equal(t.currentSession(), s[3]!.name);
  });

  it("walk is stable although resumed sessions got their mtime bumped", async () => {
    // By now s2/s3 have newer mtimes than s4 (pi appends on resume). A
    // creation-time walk must still go s4 → s3.
    await t.cmd("/rn"); await t.waitForSession(s[2]!);
    await t.cmd("/rp"); await t.waitForSession(s[3]!);
  });

  it("step notice shows position (no persistent footer row)", async () => {
    await t.cmd("/rn"); await t.waitForSession(s[2]!);
    await t.waitForText(/Resumed \(2\/4\)/);
    await t.cmd("/rp"); await t.waitForSession(s[3]!);
  });

  it("/r1 resumes the most recently active other session (by mtime)", async () => {
    // pi appends to a session on first entry, so mtimes have shifted since
    // the fixtures were written; compute the expectation from disk.
    const expected = byMtimeExcluding(s, s[3]!)[0]!;
    await t.cmd("/r1"); await t.waitForSession(expected);
  });
});

describe("TUI: /rs picker at 80 columns", { skip }, () => {
  const t = new PiTui(80, 30);
  before(() => {
    const long = "Полностью обновлён HANDOFF.md — 423 строки, детали и прочее длинное название сессии которое точно не влезет";
    // Identical label + size + mtime → identical picker rows → uniquify must kick in.
    const same = new Date("2026-01-10T00:00:00Z");
    for (const d of [1, 2, 3, 4, 5, 6]) utimesSync(t.session(d, long).file, same, same);
    t.start();
  });
  after(() => t.stop());

  it("rows never wrap and duplicates get distinct suffixes", async () => {
    await t.ready();
    await t.cmd("/rs");
    const pane = await t.waitForText(/Sessions 1-6 of 6/);
    const lines = pane.split("\n");
    const start = lines.findIndex((l) => /Sessions 1-6/.test(l));
    const rows = lines.slice(start + 1).filter((l) => /\d+d ago|just now|\d+[hm] ago/.test(l));
    assert.equal(rows.length, 6, `expected 6 single-line rows, pane:\n${pane}`);
    for (const r of rows) assert.ok(r.length <= 80, `row wider than 80: ${r}`);
    assert.ok(rows.some((r) => /\(2\)/.test(r)), "duplicate labels should be suffixed");
    // Every row is unique text.
    assert.equal(new Set(rows.map((r) => r.trim().replace(/^→\s*/, ""))).size, 6);
  });

  it("arrow keys move the cursor row by row", async () => {
    t.keys("Down", "Down", "Down");
    await sleep(400);
    const pane = t.pane();
    const lines = pane.split("\n");
    const start = lines.findIndex((l) => /Sessions 1-6/.test(l));
    const rows = lines.slice(start + 1).filter((l) => /\d+d ago|just now/.test(l));
    const cursorIdx = rows.findIndex((l) => /^\s*→/.test(l));
    assert.equal(cursorIdx, 3, `cursor should be on 4th row, pane:\n${pane}`);
  });

  it("Enter on a row switches to that session", async () => {
    // Picker rows follow statScan order; cursor is on the 4th row. Compute
    // BEFORE switching: pi appends to the session on entry, bumping its mtime.
    const expected = (await statScan(t.sessionDir))[3]!.file;
    t.keys("Enter");
    await t.waitFor(() => t.currentSession() !== undefined, 20_000);
    assert.equal(t.currentSession(), basename(expected, ".jsonl"));
  });

  it("/rs set clamps and persists; bare /rs set shows config", async () => {
    await t.cmd("/rs set page 999");
    await t.waitForText(/clamped to 50/);
    assert.equal(JSON.parse(readFileSync(t.configPath(), "utf8")).pageSize, 50);
    await t.cmd("/rs set");
    await t.waitForText(/Current: page 50/);
    await t.cmd("/rs set foo 1");
    await t.waitForText(/Usage: \/rs set/);
  });
});

describe("TUI: /rds deletes subagent trees only", { skip }, () => {
  const t = new PiTui(80, 30);
  let parent: Fixture;
  let treeDir: string;
  before(() => {
    parent = t.session(1, "parent session");
    t.session(2, "another session");
    treeDir = t.subagentTree(parent);
    t.start();
  });
  after(() => t.stop());

  it("asks for confirmation and deletes the tree, keeping .jsonl files", async () => {
    await t.ready();
    await t.cmd("/rds");
    await t.waitForText(/Delete 1 subagent tree \(1 run/);
    t.keys("Enter"); // first option = Delete
    await t.waitForText(/Deleted 1\/1 subagent tree/);
    assert.ok(!existsSync(treeDir), "tree dir should be gone");
    assert.ok(existsSync(parent.file), "parent .jsonl must survive");
  });

  it("reports nothing to delete afterwards", async () => {
    await t.cmd("/rds");
    await t.waitForText(/No subagent sessions to delete/);
  });
});
