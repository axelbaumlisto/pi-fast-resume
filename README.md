# pi-fast-resume

Fast session resume for [pi coding agent](https://pi.dev) without reading all `.jsonl` files.

## Problem

Built-in `/resume` reads and parses **every line** of every session file to build the picker. With hundreds of sessions this is slow.

## Solution

Two commands that use `stat()` + lazy partial reads:

| Command | What it does | Speed |
|---------|-------------|-------|
| `/r2` | Instantly switch to the most recent session | <50ms (stat-only) |
| `/rs` | Paginated picker: last 20, with tier navigation | <200ms first page |

## Install

```bash
pi install npm:pi-fast-resume
```

## Commands

### `/r2` — Instant Resume

Switches to the most recent session (by mtime) in one step. No picker, no parsing.

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

1. **`/r2`**: `readdir` → `stat` each `.jsonl` → sort by mtime → `switchSession(newest)`
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
