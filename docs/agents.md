# AI agent integration

Canonical guide for using eacli from **OpenClaw**, Cursor, or any MCP-capable agent. Everything needed to operate eacli lives in this repository.

**Placeholder:** `<EACLI_ROOT>` = absolute path to this clone (directory containing `package.json`).

## Prerequisites

```bash
cd <EACLI_ROOT>
npm install
npx playwright install chromium
cp .env.example .env   # USERNAME + PASSWORD for Everyone Active
npm run dev -- doctor
npm run dev -- login   # once; may open a browser
```

Session cookies are saved in `.eacli-auth-state.json`. Each MCP/CLI call launches Playwright (typically **30–90 seconds** per operation).

---

## OpenClaw (recommended)

OpenClaw stores MCP servers in its config (`openclaw mcp add`, etc.). Use the wrapper script so `.env` and the session file resolve correctly:

```bash
chmod +x <EACLI_ROOT>/bin/run-mcp.sh

openclaw mcp add eacli \
  --command <EACLI_ROOT>/bin/run-mcp.sh \
  --timeout 180 \
  --connect-timeout 30

openclaw mcp doctor eacli --probe
openclaw mcp reload
```

**Alternative** (npm from repo root):

```bash
openclaw mcp add eacli \
  --command npm \
  --arg run \
  --arg mcp \
  --cwd <EACLI_ROOT> \
  --timeout 180
```

Optional tool filter (original MCP tool names, not prefixed):

```bash
openclaw mcp tools eacli \
  --include 'list_members,list_bookings,check_availability,book_class,cancel_booking,login,doctor'
```

### Agent behaviour in OpenClaw

Point your agent at this repo's instructions:

- **[../AGENTS.md](../AGENTS.md)** — short rules (confirm before book/cancel, `members[]`, timeouts)
- **This file** — workflows and portal quirks below

OpenClaw does not load Cursor's `.cursor/skills/` automatically. Copy key rules into your OpenClaw agent system prompt, or tell the agent to read `AGENTS.md` and `docs/agents.md` from `<EACLI_ROOT>` when working on bookings.

After config changes: `openclaw mcp reload` (or restart the gateway/agent process if MCP was already cached).

---

## Cursor

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

Cursor skill (optional): [`.cursor/skills/eacli/SKILL.md`](../.cursor/skills/eacli/SKILL.md) — mirrors this guide.

---

## Other MCP hosts (stdio)

Any host that spawns a stdio MCP subprocess:

| Field | Value |
|-------|--------|
| Command | `<EACLI_ROOT>/bin/run-mcp.sh` |
| Args | `[]` |
| Cwd | `<EACLI_ROOT>` (if the host supports it) |
| Timeout | `180` seconds minimum |

Or: `command: npm`, `args: ["run", "mcp"]`, `cwd: <EACLI_ROOT>`.

Hermes-specific notes: [hermes.md](hermes.md).

---

## Without MCP (shell / tools.json)

Use **[tools.json](tools.json)** (regenerate: `npm run generate-tools`) and run:

```bash
npm run dev -- <command> [options] --json
```

Stdout is a single JSON object. See [examples.md](examples.md).

---

## Workflows

| User intent | Steps |
|-------------|--------|
| Book a class | `list_members` → resolve "me" → `check_availability` → **confirm** → `book_class` |
| What's available? | `check_availability` with **activity** and **date** |
| What am I booked into? | `list_bookings` — use `members[]` per session; note `status` |
| Cancel | `list_bookings` (optional) → **confirm** → `cancel_booking` |
| Who can I book for? | `list_members` |

### Resolving "me" / "I" / "my"

1. Call `list_members`.
2. If **exactly one** linked member → use them.
3. If **multiple** → ask which member.
4. Never guess from the activity name alone.

`book_class` auto-uses the sole member when `member` is omitted and only one exists.

### Dates

Pass natural language through: `saturday`, `next sunday`, `today`, `2026-05-25`, `25/05/2026`. For household accounts and edge-of-window classes, prefer explicit `DD/MM/YYYY` or `YYYY-MM-DD`.

---

## JSON shapes

### Envelope

```json
{ "version": 1, "ok": true, "command": "bookings.list", "data": { } }
```

```json
{ "version": 1, "ok": false, "command": "book", "error": { "message": "...", "code": "NO_SESSION" } }
```

### `list_bookings` — each item in `data.bookings`

```json
{
  "date": "Sat 13 Jun",
  "time": "08:25",
  "activity": "H I I T Sat 08:25",
  "location": "Alton Sports Centre",
  "status": "Confirmed",
  "members": ["Nick Randell", "Hayley Randell"],
  "reference": "1666CBL08250424"
}
```

- **`members`** — who is on that session (always use this; no singular `member` field).
- **`status`** — `"Confirmed"` or `"Waiting List"`.
- One object per **class session**, not per person.

### Error codes

| Code | Meaning |
|------|---------|
| `NO_SESSION` | No class on that date |
| `ACTIVITY_NOT_FOUND` | Activity not in Group Exercise list |
| `BOOKING_NOT_FOUND` | No matching booking to cancel |
| `AMBIGUOUS_MEMBER` | Multiple bookings match — need member |
| `MEMBER_NOT_FOUND` | Name not in linked members |
| `MEMBER_SWITCH_FAILED` | Could not switch linked member |
| `NOT_LOGGED_IN` | Login required (`login` tool or `npm run dev -- login`) |
| `SITE_ERROR` | Portal error page |
| `TIMEOUT` | Playwright timeout — retry or increase MCP timeout |

---

## Portal quirks

- **Manage Bookings layout** — The portal uses separate tables for waitlist vs confirmed bookings. `list_bookings` and `cancel_booking` parse all of them.
- **Secondary linked members** — QuickBook/favourite navigation can return empty sessions plus an "on behalf of …" banner even when browse would show slots. Tools auto-fallback to browse when needed; still pass explicit full member name and precise dates.
- **`book_class` confirmation** — `confirmed: false` does not always mean failure. Check `.eacli-session/last-book-result.html` and call `list_bookings` before retrying.
- **`check_availability` `pageMessage`** — Warning banner text on the class page; if sessions are also returned, prefer the sessions for decisions.

---

## MCP tool reference

| Tool | Purpose |
|------|---------|
| `list_members` | Linked household members |
| `list_bookings` | Upcoming sessions (waitlist + confirmed) |
| `list_favourites` | QuickBook shortcuts |
| `check_availability` | Slots for one activity + date |
| `book_class` | Book after user confirmation |
| `cancel_booking` | Cancel after user confirmation |
| `login` | Force re-login |
| `doctor` | Local setup check (no EA login) |

Tool descriptions in MCP are generated from [src/tools/schema.ts](../src/tools/schema.ts). Runtime instructions: [src/mcp/server.ts](../src/mcp/server.ts).

---

## Troubleshooting

| Issue | Action |
|-------|--------|
| `NOT_LOGGED_IN` | `npm run dev -- login` from `<EACLI_ROOT>` |
| Slow / `TIMEOUT` | Increase MCP timeout to 180s+; avoid rapid retries |
| Wrong member on booking | Pass explicit `member`; call `list_members` first |
| Missing bookings | Re-run `list_bookings`; use `--debug` and inspect `.eacli-session/` HTML dumps |
| MCP can't find `.env` | Use `bin/run-mcp.sh` or set `--cwd <EACLI_ROOT>` |

```bash
DEBUG=1 npm run dev -- bookings list --json
```