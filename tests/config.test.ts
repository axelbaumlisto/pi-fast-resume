import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { clampPage, clampDays, applySetting } from "../src/config.ts";

describe("clampPage", () => {
  it("clamps below minimum to 1", () => assert.equal(clampPage(0), 1));
  it("clamps above maximum to 50", () => assert.equal(clampPage(100), 50));
  it("passes valid value through", () => assert.equal(clampPage(20), 20));
  it("clamps negative to 1", () => assert.equal(clampPage(-5), 1));
});

describe("clampDays", () => {
  it("clamps below minimum to 0", () => assert.equal(clampDays(-1), 0));
  it("clamps above maximum to 30", () => assert.equal(clampDays(60), 30));
  it("passes valid value through", () => assert.equal(clampDays(7), 7));
  it("allows zero (no filter)", () => assert.equal(clampDays(0), 0));
});

describe("applySetting", () => {
  const base = { pageSize: 20, maxDays: 7 };
  const ok = (r: ReturnType<typeof applySetting>) => { assert.ok(!("error" in r)); return r as { cfg: typeof base; message: string }; };

  it("sets page in range", () => {
    const r = ok(applySetting(base, "page", "30"));
    assert.equal(r.cfg.pageSize, 30);
    assert.match(r.message, /set to 30/);
  });
  it("clamps page and says so", () => {
    const r = ok(applySetting(base, "page", "999"));
    assert.equal(r.cfg.pageSize, 50);
    assert.match(r.message, /clamped to 50/);
  });
  it("days 0 disables filter", () => {
    const r = ok(applySetting(base, "days", "0"));
    assert.equal(r.cfg.maxDays, 0);
    assert.match(r.message, /disabled/);
  });
  it("clamps days", () => assert.equal(ok(applySetting(base, "days", "100")).cfg.maxDays, 30));
  it("does not mutate input", () => { applySetting(base, "page", "5"); assert.equal(base.pageSize, 20); });
  it("unknown key → error", () => assert.ok("error" in applySetting(base, "foo", "1")));
  it("non-numeric → error", () => assert.ok("error" in applySetting(base, "page", "abc")));
  it("missing value → error", () => assert.ok("error" in applySetting(base, "page", undefined)));
});
