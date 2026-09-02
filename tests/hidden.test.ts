import { describe, it, before, after, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, writeFileSync, rmSync, statSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Point the fork cache at a temp pi-agent dir BEFORE importing the module.
const AGENT_DIR = join(tmpdir(), `pi-fast-resume-hidden-${Date.now()}`);
process.env.PI_CODING_AGENT_DIR = AGENT_DIR;
const { isSubagentFork, pruneForkCache, clearForkCache } = await import("../src/hidden.ts");

const SESS = join(AGENT_DIR, "sessions", "--proj--");
const CACHE = join(AGENT_DIR, "extensions", "pi-fast-resume", "fork-cache.json");

const header = (parent?: string) => ({
  type: "session",
  version: 3,
  id: "x",
  timestamp: "2026-01-01T00:00:00.000Z",
  cwd: "/p",
  ...(parent ? { parentSession: parent } : {}),
});
const userMsg = (text: string) => ({
  type: "message",
  message: { role: "user", content: [{ type: "text", text }] },
});
const filler = (n: number) => Array.from({ length: n }, (_, i) => userMsg(`filler ${i} ${"x".repeat(200)}`));

function write(name: string, lines: object[]): { file: string; mtime: Date; size: number } {
  const file = join(SESS, name);
  writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  const s = statSync(file);
  return { file, mtime: s.mtime, size: s.size };
}

before(() => mkdirSync(SESS, { recursive: true }));
after(() => rmSync(AGENT_DIR, { recursive: true, force: true }));
beforeEach(() => {
  clearForkCache();
  rmSync(CACHE, { force: true });
});

describe("isSubagentFork", () => {
  it("plain session (no parentSession) → false, no content scan", async () => {
    const ref = write("plain.jsonl", [header(), userMsg("You are a delegated subagent — but no parent")]);
    assert.equal(await isSubagentFork(ref), false);
  });

  it("manual /fork (parentSession, no subagent marker) → false", async () => {
    const ref = write("fork.jsonl", [header("/p/parent.jsonl"), ...filler(30), userMsg("continue please")]);
    assert.equal(await isSubagentFork(ref), false);
  });

  it("subagent fork: task marker deep in file → true", async () => {
    const ref = write("sub-task.jsonl", [
      header("/p/parent.jsonl"),
      ...filler(50),
      userMsg("Task: You are a delegated subagent running from a fork of the parent session. Do X."),
      ...filler(50),
    ]);
    assert.equal(await isSubagentFork(ref), true);
  });

  it("subagent fork: session_info name in tail → true (fast path)", async () => {
    const ref = write("sub-name.jsonl", [
      header("/p/parent.jsonl"),
      ...filler(20),
      { type: "session_info", name: "subagent-worker-84744157-1" },
    ]);
    assert.equal(await isSubagentFork(ref), true);
  });

  it("caches verdict on disk keyed by mtime+size", async () => {
    const ref = write("cached.jsonl", [
      header("/p/parent.jsonl"),
      userMsg("You are a delegated subagent"),
    ]);
    assert.equal(await isSubagentFork(ref), true);
    assert.ok(existsSync(CACHE));
    const raw = JSON.parse(readFileSync(CACHE, "utf8"));
    assert.equal(raw[ref.file].h, true);

    // Same stat → served from cache even if content changed underneath.
    writeFileSync(ref.file, JSON.stringify(header()) + "\n");
    assert.equal(await isSubagentFork(ref), true);

    // Different size → re-detected.
    const fresh = { ...ref, size: statSync(ref.file).size, mtime: new Date(Date.now() + 5000) };
    assert.equal(await isSubagentFork(fresh), false);
  });

  it("missing file → false", async () => {
    assert.equal(
      await isSubagentFork({ file: join(SESS, "nope.jsonl"), mtime: new Date(), size: 100 }),
      false,
    );
  });
});

describe("pruneForkCache", () => {
  it("drops entries for vanished files in the dir, keeps other dirs", async () => {
    const a = write("a.jsonl", [header("/p/x"), userMsg("You are a delegated subagent")]);
    await isSubagentFork(a);
    const other = { file: "/elsewhere/--other--/b.jsonl", mtime: new Date(), size: 0 };
    await isSubagentFork(other); // missing → false, but cached

    await pruneForkCache(SESS, new Set()); // a.jsonl "vanished"
    const raw = JSON.parse(readFileSync(CACHE, "utf8"));
    assert.equal(raw[a.file], undefined);
    assert.ok(raw[other.file]);
  });
});
