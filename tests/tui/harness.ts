/**
 * tmux harness for interactive (TUI) e2e tests.
 *
 * Runs a real `pi` in an isolated PI_CODING_AGENT_DIR with ONLY this
 * extension loaded, drives it through tmux, and reads back state via the
 * pane text and the extension's own active-session registry
 * (`<agent-dir>/extensions/pi-fast-resume/active/<pid>.json`), which records
 * exactly which session file the pi process currently holds.
 */

import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync, utimesSync, realpathSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";

const REPO = realpathSync(join(import.meta.dirname ?? new URL(".", import.meta.url).pathname, "..", ".."));

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface Fixture {
  /** Basename without .jsonl */
  name: string;
  file: string;
  label: string;
}

export class PiTui {
  readonly agentDir: string;
  readonly cwd: string;
  readonly sessionDir: string;
  readonly tmux: string;
  private started = false;

  constructor(cols = 80, rows = 30) {
    this.agentDir = realpathSync(mkdtempSync(join(tmpdir(), "pi-tui-agent-")));
    this.cwd = realpathSync(mkdtempSync(join(tmpdir(), "pi-tui-cwd-")));
    const enc = this.cwd.replace(/^\//, "").replace(/[/\\:]/g, "-");
    this.sessionDir = join(this.agentDir, "sessions", `--${enc}--`);
    mkdirSync(this.sessionDir, { recursive: true });
    this.tmux = `pitui-${process.pid}-${Math.random().toString(36).slice(2, 6)}`;
    this.cols = cols;
    this.rows = rows;
  }
  private cols: number;
  private rows: number;

  /** Create a session file. `day` drives both the filename timestamp and mtime (creation order). */
  session(day: number, label: string, extraLines: object[] = []): Fixture {
    const d = String(day).padStart(2, "0");
    const id = `0000000${d}-0000-0000-0000-0000000000${d}`;
    const name = `2026-01-${d}T00-00-00-000Z_${id}`;
    const file = join(this.sessionDir, `${name}.jsonl`);
    const lines = [
      { type: "session", version: 3, id, timestamp: `2026-01-${d}T00:00:00.000Z`, cwd: this.cwd },
      { type: "message", id: "m1", parentId: null, timestamp: `2026-01-${d}T00:00:01.000Z`,
        message: { role: "user", content: [{ type: "text", text: label }] } },
      ...extraLines,
    ];
    writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
    const t = new Date(`2026-01-${d}T00:00:00Z`);
    utimesSync(file, t, t);
    return { name, file, label };
  }

  /** Create a subagent tree `<parent>/<runId>/run-0/session.jsonl` under a session. */
  subagentTree(parent: Fixture, runId = "abc12345"): string {
    const dir = join(this.sessionDir, parent.name, runId, "run-0");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "session.jsonl"), JSON.stringify({ type: "session", version: 3, id: runId, cwd: this.cwd }) + "\n");
    return join(this.sessionDir, parent.name);
  }

  start(extraArgs: string[] = []): void {
    const args = [
      "--no-extensions", "-e", join(REPO, "extensions", "index.ts"),
      "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-themes",
      ...extraArgs,
    ].map((a) => `'${a}'`).join(" ");
    const cmd = `env PI_CODING_AGENT_DIR='${this.agentDir}' pi ${args}`;
    execFileSync("tmux", ["new-session", "-d", "-s", this.tmux, "-x", String(this.cols), "-y", String(this.rows), "-c", this.cwd, cmd]);
    this.started = true;
  }

  pane(history = 0): string {
    try {
      return execFileSync("tmux", ["capture-pane", "-t", this.tmux, "-p", ...(history ? ["-S", `-${history}`] : [])], { encoding: "utf8" });
    } catch {
      return "";
    }
  }

  keys(...keys: string[]): void {
    execFileSync("tmux", ["send-keys", "-t", this.tmux, ...keys]);
  }

  /**
   * Type a slash command and press Enter. Waits until the typed text is
   * visible in the editor first, so keystrokes sent while the TUI is still
   * initialising (or the machine is under load) are not lost.
   */
  async cmd(text: string): Promise<void> {
    this.keys(text);
    await this.waitFor((p) => p.includes(text), 10_000, 100);
    this.keys("Enter");
  }

  /** Poll until predicate is true or timeout. Returns the last pane text. */
  async waitFor(pred: (pane: string) => boolean, timeoutMs = 30_000, stepMs = 250): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    let p = "";
    while (Date.now() < deadline) {
      p = this.pane();
      if (pred(p)) return p;
      await sleep(stepMs);
    }
    throw new Error(`waitFor timed out. Pane:\n${p}`);
  }

  /** Wait for the TUI footer (pi ready for input). */
  async ready(): Promise<void> {
    await this.waitFor((p) => /\(auto\)/.test(p), 90_000);
    await sleep(500);
  }

  /** Session file this pi currently holds, per the extension's registry (undefined = unsaved/new). */
  currentSession(): string | undefined {
    const dir = join(this.agentDir, "extensions", "pi-fast-resume", "active");
    if (!existsSync(dir)) return undefined;
    for (const f of readdirSync(dir)) {
      try {
        const rec = JSON.parse(readFileSync(join(dir, f), "utf8"));
        if (rec?.file?.startsWith(this.sessionDir)) return basename(rec.file, ".jsonl");
      } catch {}
    }
    return undefined;
  }

  /** Wait until the registry says we hold `fixture`. */
  async waitForSession(fixture: Fixture, timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.currentSession() === fixture.name) return;
      await sleep(200);
    }
    throw new Error(`expected session ${fixture.name}, registry says ${this.currentSession()}. Pane:\n${this.pane()}`);
  }

  /** Wait for a notification/text to appear in the pane. */
  async waitForText(re: RegExp, timeoutMs = 15_000): Promise<string> {
    return this.waitFor((p) => re.test(p), timeoutMs);
  }

  configPath(): string {
    return join(this.agentDir, "extensions", "pi-fast-resume", "config.json");
  }

  stop(): void {
    if (this.started) {
      try { execSync(`tmux kill-session -t ${this.tmux}`, { stdio: "ignore" }); } catch {}
    }
    rmSync(this.agentDir, { recursive: true, force: true });
    rmSync(this.cwd, { recursive: true, force: true });
  }
}

export function tmuxAvailable(): boolean {
  try { execSync("tmux -V", { stdio: "ignore" }); execSync("pi --version", { stdio: "ignore" }); return true; } catch { return false; }
}
