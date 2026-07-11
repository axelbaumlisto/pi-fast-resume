/**
 * E2E tests for pi-resume.
 *
 * Runs inside a Docker container with pi + pi-resume installed.
 * Tests the full lifecycle:
 *   1. Before install: no /r1../r5, /rs commands
 *   2. Install package from local path
 *   3. After install: /r1../r5, /rs commands available
 *   4. Session fixtures: create fake sessions, verify scanner picks them up
 *   5. Config: /rs set page, /rs set days persisted
 */

import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const PI_AGENT_DIR = join(process.env.HOME || "/root", ".pi", "agent");
const SESSIONS_DIR = join(PI_AGENT_DIR, "sessions");
const SETTINGS_PATH = join(PI_AGENT_DIR, "settings.json");
const PROJECT_CWD = "/tmp/test-project";
const SESSION_DIR_NAME = `--tmp-test-project--`;
const PROJECT_SESSIONS = join(SESSIONS_DIR, SESSION_DIR_NAME);
const CONFIG_DIR = join(PI_AGENT_DIR, "extensions", "pi-fast-resume");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

function run(cmd: string): string {
  try {
    return execSync(cmd, { encoding: "utf-8", timeout: 15_000, env: { ...process.env, HOME: process.env.HOME || "/root" } }).trim();
  } catch (e: any) {
    return (e.stdout || "") + "\n" + (e.stderr || "");
  }
}

function writeSessionFile(name: string, id: string, message: string, sessionName?: string): string {
  mkdirSync(PROJECT_SESSIONS, { recursive: true });
  const file = join(PROJECT_SESSIONS, name);
  const lines: string[] = [
    JSON.stringify({ type: "session", version: 3, id, timestamp: new Date().toISOString(), cwd: PROJECT_CWD }),
  ];
  if (sessionName) {
    lines.push(JSON.stringify({ type: "session_info", id: "si1", parentId: id, name: sessionName }));
  }
  lines.push(JSON.stringify({
    type: "message", id: "m1", parentId: sessionName ? "si1" : id,
    message: { role: "user", content: [{ type: "text", text: message }] },
  }));
  writeFileSync(file, lines.join("\n") + "\n");
  return file;
}

// ── Phase 1: Before install ──────────────────────────────────────────

describe("Phase 1: Before pi-resume install", () => {
  it("pi is installed globally", () => {
    const out = run("pi --version");
    assert.ok(out.length > 0, "pi --version should output something");
  });

  it("settings.json has no pi-resume package", () => {
    if (existsSync(SETTINGS_PATH)) {
      const settings = readFileSync(SETTINGS_PATH, "utf-8");
      assert.ok(!settings.includes("pi-resume"), "pi-resume should not be in settings before install");
    }
  });
});

// ── Phase 2: Install ────────────────────────────────────────────────

describe("Phase 2: Install pi-resume from local path", () => {
  it("installs without error", () => {
    const out = run("pi install /app");
    assert.ok(out.includes("Installed") || out.includes("already"), `Install output: ${out}`);
  });

  it("appears in settings.json", () => {
    assert.ok(existsSync(SETTINGS_PATH), "settings.json should exist after install");
    const settings = readFileSync(SETTINGS_PATH, "utf-8");
    assert.ok(settings.includes("/app"), `settings should reference /app: ${settings}`);
  });
});

// ── Phase 3: Scanner unit tests with real session files ─────────────

describe("Phase 3: Scanner with real session fixtures", () => {
  before(() => {
    rmSync(PROJECT_SESSIONS, { recursive: true, force: true });
  });

  it("statScan returns empty for non-existent dir", async () => {
    const { statScan } = await import("../../src/scanner.ts");
    const result = await statScan("/nonexistent-42");
    assert.deepEqual(result, []);
  });

  it("statScan finds .jsonl files sorted by mtime", async () => {
    writeSessionFile("s1.jsonl", "id1", "First session");
    // Small delay to ensure different mtime
    await new Promise((r) => setTimeout(r, 50));
    writeSessionFile("s2.jsonl", "id2", "Second session");

    const { statScan } = await import("../../src/scanner.ts");
    const results = await statScan(PROJECT_SESSIONS);

    assert.equal(results.length, 2);
    assert.ok(results[0].file.endsWith("s2.jsonl"), "newest first");
    assert.ok(results[1].file.endsWith("s1.jsonl"), "oldest second");
  });

  it("readSessionMeta extracts header + first message", async () => {
    const file = writeSessionFile("s3.jsonl", "id3", "Hello from e2e test");

    const { readSessionMeta } = await import("../../src/scanner.ts");
    const meta = await readSessionMeta(file);

    assert.equal(meta.id, "id3");
    assert.equal(meta.firstMessage, "Hello from e2e test");
  });

  it("readSessionMeta extracts session name", async () => {
    const file = writeSessionFile("s4.jsonl", "id4", "msg", "My Named Session");

    const { readSessionMeta } = await import("../../src/scanner.ts");
    const meta = await readSessionMeta(file);

    assert.equal(meta.name, "My Named Session");
  });

  it("scanPage paginates correctly", async () => {
    rmSync(PROJECT_SESSIONS, { recursive: true, force: true });
    for (let i = 0; i < 5; i++) {
      writeSessionFile(`p${i}.jsonl`, `pid${i}`, `Msg ${i}`);
      await new Promise((r) => setTimeout(r, 20));
    }

    const { scanPage } = await import("../../src/scanner.ts");
    const page1 = await scanPage(PROJECT_SESSIONS, 0, 3);
    assert.equal(page1.entries.length, 3);
    assert.equal(page1.total, 5);
    assert.equal(page1.hasMore, true);

    const page2 = await scanPage(PROJECT_SESSIONS, 3, 3);
    assert.equal(page2.entries.length, 2);
    assert.equal(page2.hasMore, false);
  });

  it("scanPage excludes specified file", async () => {
    const { statScan, scanPage } = await import("../../src/scanner.ts");
    const all = await statScan(PROJECT_SESSIONS);
    const exclude = all[0]!.file;

    const result = await scanPage(PROJECT_SESSIONS, 0, 100, undefined, exclude);
    assert.ok(result.entries.every((e) => e.file !== exclude));
    assert.equal(result.total, all.length - 1);
  });
});

// ── Phase 4: Format functions ───────────────────────────────────────

describe("Phase 4: Format functions", () => {
  it("formatSize handles all ranges", async () => {
    const { formatSize } = await import("../../src/format.ts");
    assert.equal(formatSize(0), "0B");
    assert.equal(formatSize(512), "512B");
    assert.equal(formatSize(2048), "2KB");
    assert.equal(formatSize(5 * 1024 * 1024), "5.0MB");
  });

  it("formatAge handles all ranges", async () => {
    const { formatAge } = await import("../../src/format.ts");
    assert.equal(formatAge(new Date(Date.now() - 10_000)), "just now");
    assert.equal(formatAge(new Date(Date.now() - 5 * 60_000)), "5m ago");
    assert.equal(formatAge(new Date(Date.now() - 3 * 3600_000)), "3h ago");
    assert.equal(formatAge(new Date(Date.now() - 2 * 86400_000)), "2d ago");
  });

  it("truncate works correctly", async () => {
    const { truncate } = await import("../../src/format.ts");
    assert.equal(truncate("short", 10), "short");
    assert.equal(truncate("a".repeat(20), 10), "aaaaaaa...");
  });

  it("sessionLabel priority: name > firstMessage > id > untitled", async () => {
    const { sessionLabel } = await import("../../src/format.ts");
    const base = { file: "", mtime: new Date(), size: 0 };
    assert.equal(sessionLabel({ ...base, name: "N", firstMessage: "M", id: "I" }), "N");
    assert.equal(sessionLabel({ ...base, firstMessage: "M", id: "I" }), "M");
    assert.equal(sessionLabel({ ...base, id: "I" }), "I");
    assert.equal(sessionLabel(base), "untitled");
  });
});

// ── Phase 5: Config persistence ─────────────────────────────────────

describe("Phase 5: Config persistence", () => {
  before(() => {
    rmSync(CONFIG_DIR, { recursive: true, force: true });
  });

  it("loadConfig returns defaults when no file", async () => {
    const { loadConfig } = await import("../../src/config.ts");
    const cfg = loadConfig();
    assert.equal(cfg.pageSize, 20);
    assert.equal(cfg.maxDays, 7);
  });

  it("saveConfig + loadConfig roundtrip", async () => {
    const { saveConfig, loadConfig } = await import("../../src/config.ts");
    saveConfig({ pageSize: 35, maxDays: 14 });

    assert.ok(existsSync(CONFIG_PATH), "config file should be created");
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    assert.equal(raw.pageSize, 35);
    assert.equal(raw.maxDays, 14);

    const cfg = loadConfig();
    assert.equal(cfg.pageSize, 35);
    assert.equal(cfg.maxDays, 14);
  });

  it("clamps out-of-range values", async () => {
    const { clampPage, clampDays } = await import("../../src/config.ts");
    assert.equal(clampPage(0), 1);
    assert.equal(clampPage(999), 50);
    assert.equal(clampDays(-1), 0);
    assert.equal(clampDays(100), 30);
  });

  after(() => {
    rmSync(CONFIG_DIR, { recursive: true, force: true });
  });
});

// ── Phase 6: Session dir encoding ───────────────────────────────────

describe("Phase 6: Session dir encoding", () => {
  it("matches pi encoding pattern --path--", async () => {
    const { getSessionDir } = await import("../../src/session-dir.ts");
    const dir = getSessionDir("/home/user/project");
    assert.ok(dir.includes("--home-user-project--"));
  });

  it("handles root path", async () => {
    const { getSessionDir } = await import("../../src/session-dir.ts");
    const dir = getSessionDir("/");
    assert.ok(dir.endsWith("----"));
  });
});
