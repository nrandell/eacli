# eacli reference

## MCP tools

| Tool | Purpose |
|------|---------|
| `list_members` | Linked accounts on the membership |
| `list_bookings` | Upcoming bookings (per session, with `members[]`) |
| `list_favourites` | QuickBook shortcuts |
| `check_availability` | Slots for one activity + date |
| `book_class` | Book after confirmation |
| `cancel_booking` | Cancel after confirmation |
| `login` | Force re-login |
| `doctor` | Local setup check (no EA login) |

## CLI equivalents (`--json` required)

```bash
npm run dev -- members --json
npm run dev -- bookings list --json
npm run dev -- favourites list --json
npm run dev -- availability list --activity combat --date "next sunday" --json
npm run dev -- book --member Alex --activity combat --date "next sunday" --json
npm run dev -- bookings cancel --activity combat --date "next sunday" --member Alex --json
npm run dev -- login --json
npm run dev -- doctor --json
```

## JSON envelope

```json
{
  "version": 1,
  "ok": true,
  "command": "book",
  "data": { }
}
```

```json
{
  "version": 1,
  "ok": false,
  "command": "book",
  "error": { "message": "...", "code": "NO_SESSION" }
}
```

## `list_bookings` data shape

Each item in `data.bookings`:

```json
{
  "date": "Tue 19 May",
  "time": "18:40",
  "activity": "HIIT",
  "location": "Centre",
  "status": "Confirmed",
  "members": ["Nick Randell"]
}
```

- **`members`** (always use this): who is booked on that class. One or more names. Multiple names = multiple people are booked on that session.
- There is **no** singular `member` field.
- One object per class session, not one per person.

## Error codes

| Code | Meaning |
|------|---------|
| `NO_SESSION` | No class on that date |
| `ACTIVITY_NOT_FOUND` | Activity not in Group Exercise list |
| `BOOKING_NOT_FOUND` | No matching booking to cancel |
| `AMBIGUOUS_MEMBER` | Multiple bookings match — need `--member` |
| `MEMBER_NOT_FOUND` | Name not in linked members |
| `MEMBER_SWITCH_FAILED` | Could not switch linked member slider |
| `NOT_LOGGED_IN` | Login required |
| `SITE_ERROR` | Portal error page |
| `NO_SLOTS` | No book/waitlist button |
| `TIMEOUT` | Playwright navigation or locator timeout |
| `VALIDATION_ERROR` | Bad args or missing member |
| `UNKNOWN` | Other |

## OpenAI-style tools (no MCP)

See [`docs/tools.json`](../../../docs/tools.json) in the repo root.

## MCP setup (Cursor)

```json
{
  "mcpServers": {
    "eacli": {
      "command": "npm",
      "args": ["run", "mcp"],
      "cwd": "<EACLI_ROOT>"
    }
  }
}
```

Replace `<EACLI_ROOT>` with the absolute path to your clone (directory containing `package.json`). Requires `.env` with `USERNAME` and `PASSWORD`, and `npx playwright install chromium` once.

Hermes: use `<EACLI_ROOT>/bin/run-mcp.sh` — see [docs/hermes.md](../../../docs/hermes.md).
