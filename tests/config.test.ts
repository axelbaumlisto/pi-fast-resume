import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { clampPage, clampDays } from "../src/config.ts";

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
