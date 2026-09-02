# pi-fast-resume

Fast session resume for [pi coding agent](https://pi.dev) without reading all `.jsonl` files.

## Problem

Built-in `/resume` reads and parses **every line** of every session file to build the picker. With hundreds of sessions this is slow.

## Solution

Commands that use `stat()` + lazy partial reads:

| Command | What it does | Speed |
|---------|-------------|-------|
| `/r1` / `/r2` | Instantly switch to the latest / 2nd most recent session | <50ms (stat-only) |
| `pi --r N` / `--r1` / `--r2` / `--rn` | Startup flag: open pi and immediately resume the N-th most recent session | <50ms (stat-only) |
| `/rn` / `/rp` | Step to the next (older) / previous (newer) session relative to the current one | <50ms (stat-only) |
| `/rs` | Paginated picker: last 20, with tier navigation | <200ms first page |
| `/rds` | Delete subagent session trees for the current project (with confirmation) | — |

## Install

```bash
pi install npm:pi-resume
```

## Commands

### `/r1` / `/r2` — Instant Ranked Resume

Switch to the N-th most recent session (by mtime) in one step. No picker, no parsing.

- `/r1` — most recent session
- `/r2` — 2nd most recent

For anything further back use `/rn` / `/rp` — the rank changes every time you
switch (the current session is excluded), so deep ranks are more confusing
than stepping.

The current session is always excluded from the ranking, so `/r1` reliably jumps
to the previous session. If fewer sessions exist than the requested rank, a
notice is shown and nothing is switched.

### `pi --r N` — Resume at Startup

Start pi and immediately switch to the N-th most recent session (1-2):

```bash
pi --r1    # open pi in the latest session
pi --rn    # same (alias for --r1)
pi --r2    # open pi in the 2nd most recent
pi --r 2   # same, numeric form
```

Same ranking as `/r1`/`/r2`. Invalid values show an error and start a normal
new session. Interactive mode only (ignored with `-p`).

### `/rn` / `/rp` — Step Navigation

Walk the mtime-sorted session list relative to the **current** session:

- `/rn` — next session (one step **older**)
- `/rp` — previous session (one step **newer**)

Useful after `/r1` lands on the wrong session: keep pressing `/rn` to walk back
in time instead of recalculating ranks.

`/rn` / `/rp` walk by **creation time** (the timestamp in the session filename),
not by mtime: resuming a session makes extensions append to it, which bumps its
mtime and would otherwise reshuffle the list into a ping-pong between two
sessions. `/r1` and `/rs` still rank by last activity (mtime). A `(pos/total)` indicator is shown on
each switch. At the ends of the list a notice is shown and nothing is switched.

### `/rs` — Smart Resume

Shows a paginated list of recent sessions:

- **Relative time** (e.g., "2h ago"), **file size**, **session name or first message**
- **`▼ Load more...`** — next page within current filter
- **`▼ Show 14d`** — expand to 14 days
- **`▼ Show all`** — remove day filter entirely

Auto-escalates: if 7d is empty, jumps to 14d, then all.

### Configuration

```
/rs set            # Show current settings
/rs set page 30    # Sessions per page (1-50, default: 20; out-of-range values are clamped)
/rs set days 14    # Day filter for first tier (0-30, 0 = no filter, default: 7; clamped)
```

Config is stored in `~/.pi/agent/extensions/pi-fast-resume/config.json`.

### `/rds` — Delete Subagent Sessions

pi stores every subagent run under a subdirectory named like a top-level
session (`<timestamp>_<uuid>/`), containing `<runId>/run-N/session.jsonl`.
These accumulate on every subagent invocation and can bloat the sessions folder
by hundreds of MB.

`/rds` scans the **current project only**, shows how many trees / runs / MB
would be freed, asks for **confirmation**, then recursively deletes just those
subagent tree subdirectories. Your real top-level `*.jsonl` sessions (the ones
`/r1`/`/r2` and `/rs` list) are never touched.

### Sessions open in another pi are skipped

Each pi instance with this extension records its current session file in
`~/.pi/agent/extensions/pi-fast-resume/active/<pid>.json` (removed on exit;
dead or reused pids are ignored). `/r1`, `/r2`, `/rn`, `/rp` and `--r` never
land on a chat you have open in another terminal. `/rs` still lists such
sessions, marked with `⦿`, so you can see where a chat went — selecting one is
refused instead of hijacking the other instance.

### Legacy subagent forks are tidied up once

pi-subagents < 0.53 stored forked child sessions **loose** in the project
sessions dir — same filename shape and `parentSession` header as your own
`/fork`s, so they polluted `/resume` and every navigation command. Since 0.53
the canonical place is `<parent>/forks/<file>.jsonl`.

On startup this extension moves such files there (detached, in the background,
one time per file). A file is moved only if **all** hold: it was created before
the fix (2026-08-20), it has a `parentSession` header, it contains the
delegated-subagent task prompt, and **no human message follows the last task
prompt** (only orchestrator follow-ups such as steering). That last rule keeps
manual `/fork`s safe even when their inherited history contains a subagent task.
The current session and sessions open in other pi instances are skipped;
existing targets are never overwritten. After that, nothing needs filtering and
every command is stat-only again.

## How it works

1. **`/r1`/`/r2`**: `readdir` → `stat` each `.jsonl` → sort by mtime → exclude current + open elsewhere → `switchSession(others[rank-1])`
2. **`/rs`**: Same stat scan, then read only the **first ~50 lines** of each file on the current page to extract session name and first user message

No full file parsing. No `buildSessionInfo()`. No reading message content beyond the first user message.

## Development

```bash
git clone https://github.com/axelbaumlisto/pi-fast-resume.git
cd pi-fast-resume
npm install
npm test
```

## License

MIT
