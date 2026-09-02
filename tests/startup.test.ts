import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { resolveStartupRank } from "../src/ext/startup.ts";

const flags = (o: Record<string, unknown>) => (name: string) => o[name];

describe("resolveStartupRank", () => {
  it("no flags → undefined", () => assert.equal(resolveStartupRank(flags({})), undefined));
  it("--rn → rank 1", () => assert.deepEqual(resolveStartupRank(flags({ rn: true })), { rank: 1 }));
  it("--r2 → rank 2", () => assert.deepEqual(resolveStartupRank(flags({ r2: true })), { rank: 2 }));
  it("--r N wins over boolean flags", () =>
    assert.deepEqual(resolveStartupRank(flags({ r: "2", r1: true, rn: true })), { rank: 2 }));
  it("--r out of range → error", () => {
    const r = resolveStartupRank(flags({ r: "9" }));
    assert.ok(r && "error" in r);
  });
  it("--r garbage → error", () => {
    const r = resolveStartupRank(flags({ r: "abc" }));
    assert.ok(r && "error" in r);
  });
  it("respects custom maxRank", () => assert.deepEqual(resolveStartupRank(flags({ r5: true }), 5), { rank: 5 }));
});
