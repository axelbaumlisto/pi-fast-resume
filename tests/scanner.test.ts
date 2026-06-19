import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { statScan, readSessionMeta, scanPage } from "../src/scanner.ts";

const TEST_DIR = join(tmpdir(), `pi-fast-resume-test-${Date.now()}`);

function writeSession(name: string, header: object, entries: object[] = [], ageMs = 0): string {
  const file = join(TEST_DIR, name);
  const dir = join(file, "..");
  mkdirSync(dir, { recursive: true });
  const lines = [JSON.stringify(header), ...entries.map((e) => JSON.stringify(e))];
  writeFileSync(file, lines.join("\n") + "\n");
  if (ageMs > 0) {
    const past = new Date(Date.now() - ageMs);
    utimesSync(file, past, past);
  }
  return file;
}

before(() => mkdirSync(TEST_DIR, { recursive: true }));
after(() => rmSync(TEST_DIR, { recursive: true, force: true }));

describe("statScan", () => {
  it("returns empty for missing dir", async () => {
    assert.deepEqual(await statScan("/nonexistent-dir-xyz-42"), []);
  });

  it("lists .jsonl files sorted by mtime desc", async () => {
    writeSession("a.jsonl", { type: "session", id: "a" }, [], 5000);
    writeSession("b.jsonl", { type: "session", id: "b" }, [], 1000);
    writeSession("c.txt", { type: "session", id: "c" });

    const results = await statScan(TEST_DIR);
    const names = results.map((r) => r.file.split("/").pop());

    assert.ok(names.includes("b.jsonl"));
    assert.ok(names.includes("a.jsonl"));
    assert.ok(!names.includes("c.txt"), "should filter non-jsonl");

    const idxB = names.indexOf("b.jsonl");
    const idxA = names.indexOf("a.jsonl");
    assert.ok(idxB < idxA, "b (newer) should come before a (older)");
  });
});

describe("readSessionMeta", () => {
  it("extracts header fields", async () => {
    const file = writeSession("meta1.jsonl", {
      type: "session",
      version: 3,
      id: "test-id-123",
      timestamp: "2026-01-01T00:00:00Z",
      cwd: "/home/test",
    });

    const meta = await readSessionMeta(file);
    assert.equal(meta.id, "test-id-123");
    assert.equal(meta.timestamp, "2026-01-01T00:00:00Z");
    assert.equal(meta.cwd, "/home/test");
  });

  it("extracts first user message", async () => {
    const file = writeSession("meta2.jsonl", { type: "session", id: "m2" }, [
      {
        type: "message",
        id: "e1",
        parentId: null,
        message: { role: "user", content: [{ type: "text", text: "Hello from test" }] },
      },
    ]);

    const meta = await readSessionMeta(file);
    assert.equal(meta.firstMessage, "Hello from test");
  });

  it("extracts session name", async () => {
    const file = writeSession("meta3.jsonl", { type: "session", id: "m3" }, [
      { type: "session_info", id: "si1", parentId: null, name: "Named Session" },
    ]);

    const meta = await readSessionMeta(file);
    assert.equal(meta.name, "Named Session");
  });

  it("uses known mtime/size to avoid double stat", async () => {
    const file = writeSession("meta4.jsonl", { type: "session", id: "m4" });
    const known = { mtime: new Date("2020-01-01"), size: 42 };

    const meta = await readSessionMeta(file, known);
    assert.deepEqual(meta.mtime, known.mtime);
    assert.equal(meta.size, 42);
  });

  it("truncates long messages to 80 chars", async () => {
    const file = writeSession("meta5.jsonl", { type: "session", id: "m5" }, [
      {
        type: "message",
        id: "e1",
        parentId: null,
        message: { role: "user", content: [{ type: "text", text: "x".repeat(200) }] },
      },
    ]);

    const meta = await readSessionMeta(file);
    assert.equal(meta.firstMessage!.length, 80);
  });

  it("replaces newlines in first message", async () => {
    const file = writeSession("meta6.jsonl", { type: "session", id: "m6" }, [
      {
        type: "message",
        id: "e1",
        parentId: null,
        message: { role: "user", content: [{ type: "text", text: "line1\nline2\nline3" }] },
      },
    ]);

    const meta = await readSessionMeta(file);
    assert.equal(meta.firstMessage, "line1 line2 line3");
  });
});

describe("scanPage", () => {
  const PAGE_DIR = join(TEST_DIR, "page");

  before(() => {
    mkdirSync(PAGE_DIR, { recursive: true });
    for (let i = 0; i < 5; i++) {
      writeSession(join("page", `s${i}.jsonl`), { type: "session", id: `s${i}` }, [
        {
          type: "message",
          id: `e${i}`,
          parentId: null,
          message: { role: "user", content: [{ type: "text", text: `Message ${i}` }] },
        },
      ], i * 2000);
    }
  });

  it("returns first page with hasMore", async () => {
    const result = await scanPage(PAGE_DIR, 0, 3);
    assert.equal(result.entries.length, 3);
    assert.equal(result.total, 5);
    assert.equal(result.hasMore, true);
  });

  it("returns second page without hasMore", async () => {
    const result = await scanPage(PAGE_DIR, 3, 3);
    assert.equal(result.entries.length, 2);
    assert.equal(result.hasMore, false);
  });

  it("excludes specified file", async () => {
    const all = await statScan(PAGE_DIR);
    const excludeFile = all[0]!.file;

    const result = await scanPage(PAGE_DIR, 0, 10, undefined, excludeFile);
    assert.equal(result.total, 4);
    assert.ok(result.entries.every((e) => e.file !== excludeFile));
  });

  it("filters by maxDays", async () => {
    const resultAll = await scanPage(PAGE_DIR, 0, 10, 1);
    assert.equal(resultAll.total, 5);

    const resultOld = await scanPage(PAGE_DIR, 0, 10, 0.00001);
    assert.ok(resultOld.total < 5);
  });

  it("enriches entries with metadata", async () => {
    const result = await scanPage(PAGE_DIR, 0, 2);
    for (const entry of result.entries) {
      assert.ok(entry.id);
      assert.ok(entry.firstMessage?.match(/^Message \d$/));
    }
  });
});
