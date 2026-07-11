# pi-fast-resume

Fast session resume for [pi coding agent](https://pi.dev) without reading all `.jsonl` files.

## Problem

Built-in `/resume` reads and parses **every line** of every session file to build the picker. With hundreds of sessions this is slow.

## Solution

Commands that use `stat()` + lazy partial reads:

| Command | What it does | Speed |
|---------|-------------|-------|
| `/r1` … `/r5` | Instantly switch to the N-th most recent session (`/r1` = latest) | <50ms (stat-only) |
| `/rs` | Paginated picker: last 20, with tier navigation | <200ms first page |

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

### `/rs` — Smart Resume

Shows a paginated list of recent sessions:

- **Relative time** (e.g., "2h ago"), **file size**, **session name or first message**
- **`▼ Load more...`** — next page within current filter
- **`▼ Show 14d`** — expand to 14 days
- **`▼ Show all`** — remove day filter entirely

Auto-escalates: if 7d is empty, jumps to 14d, then all.

### Configuration

```
/rs set page 30    # Sessions per page (1-50, default: 20)
/rs set days 14    # Day filter for first tier (0-30, 0 = no filter, default: 7)
```

Config is stored in `~/.pi/agent/extensions/pi-fast-resume/config.json`.

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
