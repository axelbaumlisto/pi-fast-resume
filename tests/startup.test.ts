import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { startedWithContinue } from "../src/ext/startup.ts";

describe("startedWithContinue", () => {
  it("detects pi's -c / --continue", () => {
    assert.equal(startedWithContinue(["node", "pi", "-c"]), true);
    assert.equal(startedWithContinue(["node", "pi", "--continue", "-m", "x"]), true);
  });
  it("ignores other flags, including --session (explicit choice)", () => {
    assert.equal(startedWithContinue(["node", "pi"]), false);
    assert.equal(startedWithContinue(["node", "pi", "--session", "abc"]), false);
    assert.equal(startedWithContinue(["node", "pi", "-r"]), false);
  });
});
