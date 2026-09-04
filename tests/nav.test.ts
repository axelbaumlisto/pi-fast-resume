import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { rankTarget, navTarget, filterVisible, createdAtFromName, sortByCreated } from "../src/nav.ts";

const files = [{ file: "/s/newest" }, { file: "/s/mid" }, { file: "/s/oldest" }];

// 5-element list with two hidden entries for skip tests.
const files5 = [
  { file: "/s/1" },
  { file: "/s/2-hidden" },
  { file: "/s/3" },
  { file: "/s/4-hidden" },
  { file: "/s/5" },
];
const hideMarked = async (f: { file: string }) => f.file.endsWith("-hidden");

describe("rankTarget", () => {
  it("rank 1 = latest, current excluded", async () => {
    const { target } = await rankTarget(files, "/s/newest", 1);
    assert.equal(target?.file, "/s/mid");
  });

  it("rank 1 with no current = newest", async () => {
    const { target } = await rankTarget(files, undefined, 1);
    assert.equal(target?.file, "/s/newest");
  });

  it("rank beyond list → undefined + count", async () => {
    const { target, othersCount } = await rankTarget(files, "/s/newest", 5);
    assert.equal(target, undefined);
    assert.equal(othersCount, 2);
  });

  it("empty list", async () => {
    const { target, othersCount } = await rankTarget([], undefined, 1);
    assert.equal(target, undefined);
    assert.equal(othersCount, 0);
  });

  it("skips hidden files when ranking", async () => {
    const r1 = await rankTarget(files5, "/s/1", 1, hideMarked);
    assert.equal(r1.target?.file, "/s/3");
    const r2 = await rankTarget(files5, "/s/1", 2, hideMarked);
    assert.equal(r2.target?.file, "/s/5");
    const r3 = await rankTarget(files5, "/s/1", 3, hideMarked);
    assert.equal(r3.target, undefined);
    assert.equal(r3.othersCount, 2);
  });

  it("evaluates hidden lazily — stops at the target", async () => {
    const asked: string[] = [];
    const spy = async (f: { file: string }) => {
      asked.push(f.file);
      return false;
    };
    await rankTarget(files5, undefined, 1, spy);
    assert.deepEqual(asked, ["/s/1"]);
  });
});

describe("navTarget", () => {
  it("next (older) from middle", async () => {
    const { target, pos, total } = await navTarget(files, "/s/mid", 1);
    assert.equal(target?.file, "/s/oldest");
    assert.equal(pos, 3);
    assert.equal(total, 3);
  });

  it("prev (newer) from middle", async () => {
    const { target, pos } = await navTarget(files, "/s/mid", -1);
    assert.equal(target?.file, "/s/newest");
    assert.equal(pos, 1);
  });

  it("edge: already oldest", async () => {
    assert.equal((await navTarget(files, "/s/oldest", 1)).target, undefined);
  });

  it("edge: already newest", async () => {
    assert.equal((await navTarget(files, "/s/newest", -1)).target, undefined);
  });

  it("unsaved current session: /rn goes to newest", async () => {
    assert.equal((await navTarget(files, undefined, 1)).target?.file, "/s/newest");
  });

  it("unsaved current session: /rp has nowhere newer", async () => {
    assert.equal((await navTarget(files, undefined, -1)).target, undefined);
  });

  it("steps over hidden files in both directions", async () => {
    const older = await navTarget(files5, "/s/1", 1, hideMarked);
    assert.equal(older.target?.file, "/s/3");
    assert.equal(older.pos, 3);
    const newer = await navTarget(files5, "/s/5", -1, hideMarked);
    assert.equal(newer.target?.file, "/s/3");
  });

  it("only hidden files ahead → edge", async () => {
    const list = [{ file: "/s/a" }, { file: "/s/b-hidden" }];
    assert.equal((await navTarget(list, "/s/a", 1, hideMarked)).target, undefined);
  });

  it("unsaved current + newest hidden → first visible", async () => {
    const list = [{ file: "/s/a-hidden" }, { file: "/s/b" }];
    assert.equal((await navTarget(list, undefined, 1, hideMarked)).target?.file, "/s/b");
  });
});

describe("filterVisible", () => {
  it("drops hidden, keeps order", async () => {
    const out = await filterVisible(files5, hideMarked);
    assert.deepEqual(
      out.map((f) => f.file),
      ["/s/1", "/s/3", "/s/5"],
    );
  });
});
describe("createdAtFromName", () => {
  it("parses pi session filename timestamp", () => {
    const t = createdAtFromName("/s/2026-08-10T14-31-05-921Z_019fec15-97c1-7a42-bf80-307a87d6d5ae.jsonl");
    assert.equal(t, Date.parse("2026-08-10T14:31:05.921Z"));
  });
  it("undefined for non-matching names", () => {
    assert.equal(createdAtFromName("/s/random.jsonl"), undefined);
  });
});

describe("sortByCreated", () => {
  const mk = (name: string, mtimeMs: number) => ({ file: `/s/${name}`, mtime: new Date(mtimeMs) });
  const A = mk("2026-08-01T00-00-00-000Z_a.jsonl", 0);
  const B = mk("2026-08-02T00-00-00-000Z_b.jsonl", 0);
  const C = mk("2026-08-03T00-00-00-000Z_c.jsonl", 0);

  it("orders newest-created first regardless of mtime", () => {
    // mtime says A is newest (just resumed) — creation order must win.
    const shuffled = [{ ...A, mtime: new Date(9e12) }, C, B];
    assert.deepEqual(sortByCreated(shuffled).map((f) => f.file), [C.file, B.file, A.file]);
  });

  it("walk is stable when resumed sessions get their mtime bumped", async () => {
    let files = [C, B, A];
    // /rn from C -> B
    let r = await navTarget(sortByCreated(files), C.file, 1);
    assert.equal(r.target?.file, B.file);
    // resuming B bumps its mtime to now (extension appended on session_start)
    files = files.map((f) => (f.file === B.file ? { ...f, mtime: new Date(9e12) } : f));
    // /rn from B must go to A, not ping-pong back to C
    r = await navTarget(sortByCreated(files), B.file, 1);
    assert.equal(r.target?.file, A.file);
    // /rp from A -> B, /rp from B -> C
    assert.equal((await navTarget(sortByCreated(files), A.file, -1)).target?.file, B.file);
    assert.equal((await navTarget(sortByCreated(files), B.file, -1)).target?.file, C.file);
  });

  it("falls back to mtime for unparseable names", () => {
    const x = mk("x.jsonl", 100), y = mk("y.jsonl", 200);
    assert.deepEqual(sortByCreated([x, y]).map((f) => f.file), [y.file, x.file]);
  });
});
