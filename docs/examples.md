# eacli examples

All examples assume you are in the repo root and have run `npm install`, `npx playwright install chromium`, and created `.env` from `.env.example`.

Use **`npm run dev --`** during development, or after **`npm run build`**:

```bash
node dist/index.js <command>
# or
npm link && eacli <command>
```

Append **`--json`** for machine-readable output (one JSON object on stdout).

## Setup

```bash
cp .env.example .env
# edit .env

npm run dev -- doctor
npm run dev -- login
```

## Members and bookings

```bash
# Human-readable tables
npm run dev -- members
npm run dev -- bookings list

# JSON for scripts / agents
npm run dev -- members --json
npm run dev -- bookings list --json
```

Example `bookings list --json` success payload (shape only):

```json
{
  "version": 1,
  "ok": true,
  "command": "bookings.list",
  "data": {
    "bookings": [
      {
        "date": "Thu 21 May",
        "time": "19:00",
        "activity": "Combat Thu 19:00",
        "location": "Centre",
        "status": "Confirmed",
        "reference": "1234567890",
        "member": "Alex Smith"
      }
    ]
  }
}
```

## Availability

Always pass **activity** and **date** when checking before a book (a full scan without `--activity` is slow).

```bash
npm run dev -- availability list --activity hiit --date saturday
npm run dev -- availability list --activity combat --date "next sunday" --json
```

## Book a class

```bash
npm run dev -- book --member Alex --activity hiit --date saturday
npm run dev -- book --member Alex --activity combat --date 2026-05-25 --json
```

On success, `data` includes `member`, `activity`, `sessionLabel`, `confirmed`, and `waitlisted`.

## Cancel a booking

```bash
npm run dev -- bookings cancel --activity combat --date "thu 21 may" --member Alex
npm run dev -- bookings cancel --activity hiit --date saturday --json
```

## Favourites

```bash
npm run dev -- favourites list
```

## Debug

```bash
npm run dev -- bookings list --debug
```

Saves HTML under `.eacli-session/` when parsing fails.

## Error codes (`--json`)

| Code | Typical cause |
|------|----------------|
| `NO_SESSION` | No class on that date for the activity |
| `ACTIVITY_NOT_FOUND` | Name not found under Group Exercise |
| `BOOKING_NOT_FOUND` | Nothing to cancel matching activity/date |
| `AMBIGUOUS_MEMBER` | Several bookings match — add `--member` |
| `MEMBER_NOT_FOUND` | Name not in linked members |
| `NOT_LOGGED_IN` | Run `npm run dev -- login` |
| `SITE_ERROR` | Portal error page |
| `VALIDATION_ERROR` | Bad date or missing argument |

Example error:

```json
{
  "version": 1,
  "ok": false,
  "command": "book",
  "error": {
    "message": "No session on Sat 23 May for H I I T Sat 08:25. Available sessions: ...",
    "code": "NO_SESSION"
  }
}
```

## MCP server (manual test)

```bash
npm run mcp
# stdio MCP — normally started by Cursor or Hermes, not used interactively
```
