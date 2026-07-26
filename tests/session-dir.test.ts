import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { getSessionDir } from "../src/session-dir.ts";

describe("getSessionDir", () => {
  it("encodes cwd with double-dash wrapping", () => {
    const dir = getSessionDir("/home/spex/work/grep_app");
    assert.ok(dir.includes("--home-spex-work-grep_app--"));
  });

  it("strips leading slash and replaces path separators", () => {
    const dir = getSessionDir("/a/b/c");
    assert.ok(dir.includes("--a-b-c--"));
  });

  it("handles root path", () => {
    const dir = getSessionDir("/");
    assert.ok(dir.includes("----"));
  });

  it("prefers dirname of the current session file when provided", () => {
    const dir = getSessionDir("/any/cwd", "/custom/sessions/--proj--/2026_abc.jsonl");
    assert.equal(dir, "/custom/sessions/--proj--");
  });
});
