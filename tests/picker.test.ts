import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { uniquify, buildPickerItems, resolveChoice } from "../src/picker.ts";

describe("uniquify", () => {
  it("keeps unique labels unchanged", () => {
    assert.deepEqual(uniquify(["a", "b", "c"]), ["a", "b", "c"]);
  });

  it("suffixes duplicates with counters", () => {
    assert.deepEqual(uniquify(["x", "x", "x"]), ["x", "x (2)", "x (3)"]);
  });

  it("handles mixed duplicates", () => {
    assert.deepEqual(uniquify(["a", "b", "a"]), ["a", "b", "a (2)"]);
  });

  it("empty input", () => assert.deepEqual(uniquify([]), []));
});

describe("buildPickerItems", () => {
  it("entries only", () => {
    assert.deepEqual(buildPickerItems(["e1", "e2"]), ["e1", "e2"]);
  });

  it("adds Load more with count", () => {
    const items = buildPickerItems(["e1"], { remaining: 8 });
    assert.deepEqual(items, ["e1", "▼ Load more... (8 remaining)"]);
  });

  it("adds tier row", () => {
    const items = buildPickerItems(["e1"], { nextTierLabel: "14d" });
    assert.deepEqual(items, ["e1", "▼ Show 14d"]);
  });

  it("uniquifies duplicate entries", () => {
    const items = buildPickerItems(["same", "same"], { remaining: 1 });
    assert.deepEqual(items, ["same", "same (2)", "▼ Load more... (1 remaining)"]);
  });
});

describe("resolveChoice", () => {
  const items = buildPickerItems(["dup", "dup", "dup"], { remaining: 5, nextTierLabel: "14d" });

  it("cancel on undefined/null", () => {
    assert.deepEqual(resolveChoice(items, undefined, 3), { kind: "cancel" });
    assert.deepEqual(resolveChoice(items, null, 3), { kind: "cancel" });
  });

  it("resolves each duplicate to its OWN index", () => {
    assert.deepEqual(resolveChoice(items, "dup", 3), { kind: "entry", index: 0 });
    assert.deepEqual(resolveChoice(items, "dup (2)", 3), { kind: "entry", index: 1 });
    assert.deepEqual(resolveChoice(items, "dup (3)", 3), { kind: "entry", index: 2 });
  });

  it("resolves Load more", () => {
    assert.deepEqual(resolveChoice(items, "▼ Load more... (5 remaining)", 3), { kind: "more" });
  });

  it("resolves tier switch", () => {
    assert.deepEqual(resolveChoice(items, "▼ Show 14d", 3), { kind: "tier" });
  });

  it("unknown string → cancel", () => {
    assert.deepEqual(resolveChoice(items, "garbage", 3), { kind: "cancel" });
  });
});
