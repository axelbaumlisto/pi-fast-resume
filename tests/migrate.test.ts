import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, writeFileSync, rmSync, statSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { findLegacyForks, migrateLegacyForks, forkTarget } from "../src/migrate.ts";
import { statScan } from "../src/scanner.ts";

const SESS = join(tmpdir(), `pi-fast-resume-migrate-${Date.now()}`);
const PARENT = join(SESS, "2026-07-22T12-00-37-645Z_019f89b3-010d-7f1f-b017-9e47c1c38bd6.jsonl");

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
const filler = (n: number) =>
  Array.from({ length: n }, (_, i) => userMsg(`filler ${i} ${"x".repeat(200)}`));

function write(name: string, lines: object[]) {
  const file = join(SESS, name);
  writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  const s = statSync(file);
  return { file, mtime: s.mtime, size: s.size };
}

before(() => mkdirSync(SESS, { recursive: true }));
after(() => rmSync(SESS, { recursive: true, force: true }));

describe("forkTarget", () => {
  it("nests under <parent-basename>/forks/ in the child's dir", () => {
    assert.equal(
      forkTarget("/s/dir/child.jsonl", "/other/dir/parent.jsonl"),
      "/s/dir/parent/forks/child.jsonl",
    );
  });
});

describe("findLegacyForks", () => {
  it("classifies loose files", async () => {
    write(PARENT.split("/").pop()!, [header(), userMsg("hi")]);
    const plain = write("2026-07-01T00-00-00-000Z_plain.jsonl", [
      header(),
      userMsg("You are a delegated subagent — mentioned, but no parent"),
    ]);
    const manual = write("2026-07-02T00-00-00-000Z_manual.jsonl", [
      header(PARENT),
      ...filler(30),
      userMsg("continue please"),
    ]);
    const subTask = write("2026-07-03T00-00-00-000Z_subtask.jsonl", [
      header(PARENT),
      ...filler(50),
      userMsg("Task: You are a delegated subagent running from a fork of the parent session. Do X."),
      ...filler(50),
    ]);
    const subName = write("2026-07-04T00-00-00-000Z_subname.jsonl", [
      header(PARENT),
      ...filler(20),
      { type: "session_info", name: "subagent-worker-84744157-1" },
    ]);
    write("2026-07-05T00-00-00-000Z_empty.jsonl", []);

    const forks = await findLegacyForks(await statScan(SESS));
    const found = forks.map((f) => f.file).sort();
    assert.deepEqual(found, [subTask.file, subName.file].sort());
    assert.ok(!found.includes(plain.file));
    assert.ok(!found.includes(manual.file));
    for (const f of forks) assert.equal(f.target, forkTarget(f.file, PARENT));
  });

  it("honours skip set (current / active elsewhere)", async () => {
    const all = await statScan(SESS);
    const forks = await findLegacyForks(all);
    const skip = new Set([forks[0]!.file]);
    const rest = await findLegacyForks(all, skip);
    assert.equal(rest.length, forks.length - 1);
    assert.ok(!rest.some((f) => skip.has(f.file)));
  });
});

describe("migrateLegacyForks", () => {
  it("moves forks into place, never clobbers, disappears from statScan", async () => {
    const forks = await findLegacyForks(await statScan(SESS));
    assert.equal(forks.length, 2);

    // Pre-create one target to verify no-clobber.
    const blocked = forks[0]!;
    mkdirSync(join(blocked.target, ".."), { recursive: true });
    writeFileSync(blocked.target, "keep me\n");

    const moved = await migrateLegacyForks(forks);
    assert.equal(moved, 1);
    assert.equal(readFileSync(blocked.target, "utf8"), "keep me\n");
    assert.ok(existsSync(blocked.file), "blocked source left in place");
    assert.ok(existsSync(forks[1]!.target));
    assert.ok(!existsSync(forks[1]!.file));

    const remaining = (await statScan(SESS)).map((f) => f.file);
    assert.ok(!remaining.includes(forks[1]!.file));
    assert.ok(remaining.includes(blocked.file));
  });

  it("second run finds only the blocked one", async () => {
    const forks = await findLegacyForks(await statScan(SESS));
    assert.equal(forks.length, 1);
    assert.equal(await migrateLegacyForks(forks), 0);
  });
});
