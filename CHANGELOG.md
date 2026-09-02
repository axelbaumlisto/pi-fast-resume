# Changelog

## 1.5.0
- `/rn` / `/rp` position is shown in the footer status (`session 3/80`); the
  transient notice was being replaced by pi's own "Resumed session".
- `pi --rN` waits for the provider refresh at most 15 s before resuming.
- Picker rows leave room for the duplicate suffix ` (N)` so it is never clipped.
- New interactive e2e suite (`npm run test:tui`): a real pi TUI in tmux with an
  isolated agent dir — startup flag, `/rn` `/rp` walk stability, `/r1`, `/rs`
  picker (single-line rows at 80 cols, arrow navigation, Enter, duplicates),
  `/rs set`, `/rds`. Runs in CI.

## 1.4.0
- Refactor only: `extensions/index.ts` split into `src/ext/*` (one module per
  concern), shared `loadSessions()`, all user-facing strings in `messages.ts`,
  pure `applySetting()` / `resolveStartupRank()` with unit tests.

## 1.3.2
- Fix: `pi --rN` / `--rn` never actually switched (startup context has no
  `switchSession`). Now dispatches `/rN` as a command after the provider
  refresh finishes (switching mid-refresh crashed pi with an AbortError).

## 1.3.1
- Fix: `/rn` `/rp` walk by creation time instead of mtime — resuming bumps
  mtime and made the walk ping-pong between two sessions.

## 1.3.0
- Legacy subagent fork sessions migrated into `<parent>/forks/`.
- Sessions open in another live pi are skipped by navigation and marked in
  `/rs`; pid-reuse guard for the registry.

## 1.2.x
- `/r3`–`/r5` removed (`/rn` `/rp` cover it); docs fixes.

## 1.1.0
- `/rn` `/rp` step navigation; `pi --r N` / `--r1` / `--rn` startup flags.
- Fix: picker rows wrapped on narrow terminals and broke cursor navigation.
- Fix: duplicate picker rows resolved to the wrong session.
- Session renames appended past the head window are picked up (tail read).
- Metadata cache keyed by (file, mtime, size); CI.
