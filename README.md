# pi-fast-resume

Fast session resume for [pi coding agent](https://pi.dev) without reading all `.jsonl` files.

## Problem

Built-in `/resume` reads and parses **every line** of every session file to build the picker. With hundreds of sessions this is slow.

## Solution

Commands that use `stat()` + lazy partial reads:

| Command | What it does | Speed |
|---------|-------------|-------|
| `/r1` … `/r5` | Instantly switch to the N-th most recent session (`/r1` = latest) | <50ms (stat-only) |
| `pi --r N` / `--r1`…`--r5` / `--rn` | Startup flag: open pi and immediately resume the N-th most recent session | <50ms (stat-only) |
| `/rn` / `/rp` | Step to the next (older) / previous (newer) session relative to the current one | <50ms (stat-only) |
| `/rs` | Paginated picker: last 20, with tier navigation | <200ms first page |
| `/rds` | Delete subagent session trees for the current project (with confirmation) | — |

## Install

```bash
pi install npm:pi-fast-resume
```

## Commands

### `/r1` … `/r5` — Instant Ranked Resume

Switch to the N-th most recent session (by mtime) in one step. No picker, no parsing.

- `/r1` — most recent session
- `/r2` — 2nd most recent
- … up to `/r5` — 5th most recent

The current session is always excluded from the ranking, so `/r1` reliably jumps
to the previous session. If fewer sessions exist than the requested rank, a
notice is shown and nothing is switched.

### `pi --r N` — Resume at Startup

Start pi and immediately switch to the N-th most recent session (1-5):

```bash
pi --r1    # open pi in the latest session
pi --rn    # same (alias for --r1)
pi --r3    # open pi in the 3rd most recent
pi --r 3   # same, numeric form
```

Same ranking as `/r1`…`/r5`. Invalid values show an error and start a normal
new session. Interactive mode only (ignored with `-p`).

### `/rn` / `/rp` — Step Navigation

Walk the mtime-sorted session list relative to the **current** session:

- `/rn` — next session (one step **older**)
- `/rp` — previous session (one step **newer**)

Useful after `/r1` lands on the wrong session: keep pressing `/rn` to walk back
in time instead of recalculating ranks. A `(pos/total)` indicator is shown on
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
`/r1`…`/r5` and `/rs` list) are never touched.

## How it works

1. **`/r1`…`/r5`**: `readdir` → `stat` each `.jsonl` → sort by mtime → exclude current → `switchSession(others[rank-1])`
2. **`/rs`**: Same stat scan, then read only the **first ~50 lines** of each file on the current page to extract session name and first user message

No full file parsing. No `buildSessionInfo()`. No reading message content beyond the first user message.

## Development

```bash
git clone https://github.com/spex66/pi-fast-resume.git
cd pi-fast-resume
npm install
npm test
```

## License

MIT
