# eacli reference

**Canonical docs (OpenClaw, Cursor, any agent):** [docs/agents.md](../../../docs/agents.md) · [AGENTS.md](../../../AGENTS.md)

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
- **`status`**: `"Confirmed"` or `"Waiting List"` (from the Manage Bookings grid section for that row).
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

## Availability responses and pageMessage

`check_availability` returns groups with:

- `sessions`: array of `{when, status: 'available'|'waitlist'|'full'|'unknown', detail, ...}`
- `pageMessage?`: `.alert-warning` text on the class status page

When `pageMessage` is present with `sessions.length > 0`, prefer the sessions for booking decisions.

## MCP setup

See [docs/agents.md](../../../docs/agents.md) for **OpenClaw**, Cursor, and generic stdio hosts.

## OpenAI-style tools (no MCP)

See [docs/tools.json](../../../docs/tools.json). Regenerate: `npm run generate-tools`.