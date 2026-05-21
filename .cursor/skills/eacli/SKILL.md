---
name: eacli
description: >-
  Everyone Active gym bookings via eacli — list members, availability, book, cancel.
  Use when the user asks to book a class, check what's on, cancel a session, or manage
  Everyone Active / eacli. Prefer eacli MCP tools; fallback to `npm run dev -- <cmd> --json`.
---

# Everyone Active CLI (eacli)

## Tools

Use **eacli MCP tools** when the MCP server is enabled (`npm run mcp` in this repo).

If MCP is unavailable, run from the **eacli project root**:

```bash
npm run dev -- <command> [options] --json
```

Always pass **`--json`** for machine-readable output. Parse the single JSON object on stdout.

See [reference.md](reference.md) for command mapping, error codes, and JSON shapes.

## Natural language → workflow

| User intent | Steps |
|-------------|--------|
| Book a class ("book me onto combat next sunday") | `list_members` → resolve "me" → `check_availability` → **confirm with user** → `book_class` |
| What's available? | `check_availability` with **activity and date** (never scan all activities) |
| What am I booked into? | `list_bookings` — use each session's `members` array (not comma-separated `member`) |
| Cancel a class | `list_bookings` (optional) → **confirm** → `cancel_booking` |
| Who can I book for? | `list_members` |

## Resolving "me" / "I" / "my"

1. Call `list_members`.
2. If **exactly one** linked member → use that person for "me".
3. If **multiple** → ask: "Should I book for [names]?"
4. Never guess the member from the activity name alone.

`book_class` auto-uses the sole member when `member` is omitted and only one exists; otherwise pass `member` explicitly.

## Safety

- **Always confirm** with the user before `book_class` or `cancel_booking`. Show activity, date, time, and member.
- Call `check_availability` before booking. If no `available` or `waitlist` session, stop and report.
- For availability, **always** pass `activity` and `date`. A full scan without activity takes many minutes.
- On `NOT_LOGGED_IN` or session errors → ask the user to run `eacli login` once (or call `login` with `force: true`).

## Dates

Pass natural language through unchanged: `saturday`, `next sunday`, `today`, `2026-05-25`, `25/05/2026`.

## Errors

JSON errors include `error.code`. Common codes: `NO_SESSION`, `ACTIVITY_NOT_FOUND`, `BOOKING_NOT_FOUND`, `AMBIGUOUS_MEMBER`, `MEMBER_NOT_FOUND`, `MEMBER_SWITCH_FAILED`, `TIMEOUT`, `NOT_LOGGED_IN`, `SITE_ERROR`.

Run `doctor` (no browser) to verify `.env`, session file, and Playwright before blaming the portal.
