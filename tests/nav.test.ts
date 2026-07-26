import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { rankTarget, navTarget, parseRankFlag } from "../src/nav.ts";

const files = [{ file: "/s/newest" }, { file: "/s/mid" }, { file: "/s/oldest" }];

describe("rankTarget", () => {
  it("rank 1 = latest, current excluded", () => {
    const { target } = rankTarget(files, "/s/newest", 1);
    assert.equal(target?.file, "/s/mid");
  });

  it("rank 1 with no current = newest", () => {
    const { target } = rankTarget(files, undefined, 1);
    assert.equal(target?.file, "/s/newest");
  });

  it("rank beyond list → undefined + count", () => {
    const { target, othersCount } = rankTarget(files, "/s/newest", 5);
    assert.equal(target, undefined);
    assert.equal(othersCount, 2);
  });

  it("empty list", () => {
    const { target, othersCount } = rankTarget([], undefined, 1);
    assert.equal(target, undefined);
    assert.equal(othersCount, 0);
  });
});

describe("navTarget", () => {
  it("next (older) from middle", () => {
    const { target, pos, total } = navTarget(files, "/s/mid", 1);
    assert.equal(target?.file, "/s/oldest");
    assert.equal(pos, 3);
    assert.equal(total, 3);
  });

  it("prev (newer) from middle", () => {
    const { target, pos } = navTarget(files, "/s/mid", -1);
    assert.equal(target?.file, "/s/newest");
    assert.equal(pos, 1);
  });

  it("edge: already oldest", () => {
    assert.equal(navTarget(files, "/s/oldest", 1).target, undefined);
  });

  it("edge: already newest", () => {
    assert.equal(navTarget(files, "/s/newest", -1).target, undefined);
  });

  it("unsaved current session: /rn goes to newest", () => {
    assert.equal(navTarget(files, undefined, 1).target?.file, "/s/newest");
  });

  it("unsaved current session: /rp has nowhere newer", () => {
    assert.equal(navTarget(files, undefined, -1).target, undefined);
  });
});

describe("parseRankFlag", () => {
  it("unset flag → undefined", () => {
    assert.equal(parseRankFlag(undefined, 5), undefined);
    assert.equal(parseRankFlag(null, 5), undefined);
    assert.equal(parseRankFlag(false, 5), undefined);
  });

  it("valid number string", () => {
    assert.deepEqual(parseRankFlag("3", 5), { rank: 3 });
  });

  it("out of range → error", () => {
    const res = parseRankFlag("9", 5);
    assert.ok(res && "error" in res);
  });

  it("non-numeric → error", () => {
    const res = parseRankFlag("abc", 5);
    assert.ok(res && "error" in res);
  });
});
