import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { formatSize, formatAge, truncate, sessionLabel, formatEntry } from "../src/format.ts";

describe("formatSize", () => {
  it("formats bytes", () => assert.equal(formatSize(500), "500B"));
  it("formats zero", () => assert.equal(formatSize(0), "0B"));
  it("formats kilobytes", () => assert.equal(formatSize(2048), "2KB"));
  it("rounds KB up", () => assert.equal(formatSize(1536), "2KB"));
  it("formats megabytes", () => assert.equal(formatSize(5 * 1024 * 1024), "5.0MB"));
  it("formats fractional MB", () => assert.equal(formatSize(1.5 * 1024 * 1024), "1.5MB"));
});

describe("formatAge", () => {
  it("just now for <1 min", () => assert.equal(formatAge(new Date(Date.now() - 10_000)), "just now"));
  it("minutes", () => assert.equal(formatAge(new Date(Date.now() - 5 * 60_000)), "5m ago"));
  it("hours", () => assert.equal(formatAge(new Date(Date.now() - 3 * 3600_000)), "3h ago"));
  it("days", () => assert.equal(formatAge(new Date(Date.now() - 2 * 86400_000)), "2d ago"));
  it("boundary: 60 min = 1h", () => assert.equal(formatAge(new Date(Date.now() - 60 * 60_000)), "1h ago"));
  it("boundary: 24h = 1d", () => assert.equal(formatAge(new Date(Date.now() - 24 * 3600_000)), "1d ago"));
});

describe("truncate", () => {
  it("short text unchanged", () => assert.equal(truncate("hello", 10), "hello"));
  it("truncates with ellipsis", () => assert.equal(truncate("a".repeat(20), 10), "aaaaaaa..."));
  it("exact length unchanged", () => assert.equal(truncate("12345", 5), "12345"));
  it("one over truncated", () => assert.equal(truncate("123456", 5), "12..."));
});

describe("sessionLabel", () => {
  const base = { file: "", mtime: new Date(), size: 0 };

  it("prefers name", () => assert.equal(sessionLabel({ ...base, name: "My Session", firstMessage: "hi" }), "My Session"));
  it("falls back to firstMessage", () => assert.equal(sessionLabel({ ...base, firstMessage: "hello" }), "hello"));
  it("falls back to id", () => assert.equal(sessionLabel({ ...base, id: "abc123" }), "abc123"));
  it("falls back to untitled", () => assert.equal(sessionLabel(base), "untitled"));
});

describe("formatEntry", () => {
  it("formats complete entry", () => {
    const entry = { file: "/tmp/x.jsonl", mtime: new Date(Date.now() - 3600_000), size: 2048, name: "Test" };
    const result = formatEntry(entry);
    assert.ok(result.includes("1h ago"));
    assert.ok(result.includes("2KB"));
    assert.ok(result.includes("Test"));
  });
});
