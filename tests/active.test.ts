import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const AGENT_DIR = join(tmpdir(), `pi-fast-resume-active-${Date.now()}`);
process.env.PI_CODING_AGENT_DIR = AGENT_DIR;
const { markActive, unmarkActive, activeElsewhere } = await import("../src/active.ts");

const ACTIVE = join(AGENT_DIR, "extensions", "pi-fast-resume", "active");

before(() => mkdirSync(AGENT_DIR, { recursive: true }));
after(() => rmSync(AGENT_DIR, { recursive: true, force: true }));

describe("active registry", () => {
  it("own record is never reported as elsewhere", async () => {
    await markActive("/s/mine.jsonl");
    assert.ok(existsSync(join(ACTIVE, `${process.pid}.json`)));
    assert.equal((await activeElsewhere()).has("/s/mine.jsonl"), false);
    await unmarkActive();
    assert.equal(existsSync(join(ACTIVE, `${process.pid}.json`)), false);
  });

  it("record of a live foreign pid is reported", async () => {
    // Fake a "foreign" pid by reading our own record from another pid's view.
    await markActive("/s/theirs.jsonl");
    const set = await activeElsewhere(process.pid + 100_000);
    assert.equal(set.has("/s/theirs.jsonl"), true);
    await unmarkActive();
  });

  it("dead pid record is ignored and deleted", async () => {
    mkdirSync(ACTIVE, { recursive: true });
    const deadPid = 2_000_000_000; // above any real pid range
    const path = join(ACTIVE, `${deadPid}.json`);
    writeFileSync(path, JSON.stringify({ file: "/s/dead.jsonl" }));
    const set = await activeElsewhere();
    assert.equal(set.has("/s/dead.jsonl"), false);
    assert.equal(existsSync(path), false);
  });

  it("garbage records are skipped", async () => {
    mkdirSync(ACTIVE, { recursive: true });
    writeFileSync(join(ACTIVE, "notes.txt"), "hi");
    writeFileSync(join(ACTIVE, `${process.pid}.json`), "{broken");
    const set = await activeElsewhere(process.pid + 1);
    assert.equal(set.size, 0);
    rmSync(join(ACTIVE, "notes.txt"));
    await unmarkActive();
  });

  it("markActive(undefined) clears the record", async () => {
    await markActive("/s/x.jsonl");
    await markActive(undefined);
    assert.equal(existsSync(join(ACTIVE, `${process.pid}.json`)), false);
  });

  it("missing dir → empty set", async () => {
    rmSync(ACTIVE, { recursive: true, force: true });
    assert.equal((await activeElsewhere()).size, 0);
  });
});
