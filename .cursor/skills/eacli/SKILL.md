---
name: eacli
description: >-
  Everyone Active gym bookings via eacli — list members, availability, book, cancel.
  Use when the user asks to book a class, check what's on, cancel a session, or manage
  Everyone Active / eacli. Prefer eacli MCP tools; fallback to `npm run dev -- <cmd> --json`.
---

# Everyone Active CLI (eacli)

**Canonical agent documentation (all hosts):** [docs/agents.md](../../../docs/agents.md) and [AGENTS.md](../../../AGENTS.md) in the repo root.

This skill summarizes the same rules for Cursor. If anything conflicts, prefer `docs/agents.md`.

## Tools

Use **eacli MCP tools** when the MCP server is enabled (`npm run mcp` in this repo).

If MCP is unavailable, run from the **eacli project root**:

```bash
npm run dev -- <command> [options] --json
```

Always pass **`--json`** for machine-readable output. Parse the single JSON object on stdout.

See [reference.md](reference.md) for command mapping, error codes, and JSON shapes.

## Household / multi-profile (v1.5+)

The portal **no longer switches linked members**. Each person needs their own EA login in **`.eacli-profiles.json`**.

- Pass **`member`** or **`profile`** on `check_availability`, `book_class`, `cancel_booking`, `list_bookings`.
- First names work (`nick`, `hayley`). Surname-only (`randell`) does **not** resolve — use first name or `--profile`.
- `list_bookings` shows only the **active profile's** bookings.
- After editing `.eacli-profiles.json`, **restart/reload MCP**.

Setup:

```bash
cp .eacli-profiles.example.json .eacli-profiles.json
npm run dev -- login --profile nick
npm run dev -- login --profile hayley
```

Single-user installs can still use `.env` only (no profiles file).

## Natural language → workflow

| User intent | Steps |
|-------------|--------|
| Book a class ("book Hayley onto combat next tuesday") | `list_members` → `check_availability` with **member** → **confirm with user** → `book_class` with **member** |
| What's available? | `check_availability` with **activity**, **date**, and **member** when multiple profiles exist |
| What am I booked into? | `list_bookings` with **member**/**profile** — use each session's `members` array |
| Cancel a class | `list_bookings` (optional) → **confirm** → `cancel_booking` with **member** |
| Who can I book for? | `list_members` |

## Resolving "me" / "I" / "my"

1. Call `list_members`.
2. **Multi-profile:** parse `data.profiles` — ask which person if more than one.
3. **Single `.env`:** parse `data.members` — use sole member or ask.
4. Never guess from activity name alone.

`book_class` requires `member` or `profile` when multiple login profiles exist.

## Safety

- **Always confirm** with the user before `book_class` or `cancel_booking`. Show activity, date, time, and member.
- Call `check_availability` before booking. If no `available` or `waitlist` session, stop and report.
- For availability, **always** pass `activity` and `date`. A full scan without activity takes many minutes.
- On `NOT_LOGGED_IN` or session errors → `login` with `force: true` for the relevant **profile**.
- MCP timeout should be **≥ 180s** (Playwright is slow).

## Dates

Pass natural language through unchanged: `saturday`, `next sunday`, `today`, `2026-05-25`, `25/05/2026`. Prefer explicit `DD/MM/YYYY` for edge-of-window classes.

## Errors

JSON errors include `error.code`. Common codes:

`NO_SESSION`, `ACTIVITY_NOT_FOUND`, `BOOKING_NOT_FOUND`, `AMBIGUOUS_MEMBER`, `MEMBER_NOT_FOUND`, `PROFILE_NOT_FOUND`, `PROFILE_MISMATCH`, `AMBIGUOUS_PROFILE`, `MEMBER_SWITCH_FAILED`, `TIMEOUT`, `NOT_LOGGED_IN`, `SITE_ERROR`, `ALREADY_BOOKED`.

Run `doctor` (no browser) to verify profiles or `.env`, session files, and Playwright.

## Known site quirks

Full detail: [docs/agents.md](../../../docs/agents.md#portal-quirks).

- **Manage Bookings layout**: separate waitlist and confirmed tables; `list_bookings` parses all. `status` is `Confirmed` or `Waiting List`.
- **`book_class` confirmation is best-effort**: always follow with `list_bookings` for that profile. Saves `.eacli-session/last-book-result.html` on every attempt.