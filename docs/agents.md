# AI agent integration

Canonical guide for using eacli from **OpenClaw**, Cursor, or any MCP-capable agent. Everything needed to operate eacli lives in this repository.

**Placeholder:** `<EACLI_ROOT>` = absolute path to this clone (directory containing `package.json`).

## Prerequisites

```bash
cd <EACLI_ROOT>
npm install
npx playwright install chromium
cp .env.example .env   # single-account: USERNAME + PASSWORD
# Household (separate EA logins per person):
# cp .eacli-profiles.example.json .eacli-profiles.json
npm run dev -- doctor
npm run dev -- login   # once per profile: login --profile nick
```

Session cookies are saved per profile in `.eacli-session/auth-<profile>.json`. Each MCP/CLI call launches Playwright (typically **30–90 seconds** per operation).

### Configuration: `.env` vs `.eacli-profiles.json`

| Setup | Use |
|-------|-----|
| **One person** | `.env` with `USERNAME` / `PASSWORD` only (implicit `default` profile) |
| **Household (2+ EA logins)** | `.eacli-profiles.json` — one entry per person with their own credentials |

We **do not require** `.eacli-profiles.json` for everyone: single-user installs keep working with `.env`. Enforcing profiles globally would break that path without improving single-account flows. For households, profiles are required in practice because the portal member switcher is gone.

**Profile config cache:** `loadProfilesConfig()` caches `.eacli-profiles.json` for the lifetime of the MCP server process. After editing credentials or adding profiles, run `openclaw mcp reload` / restart the MCP host (CLI one-shot commands always reload).

### `list_members` JSON shape (v1.5+)

| Condition | `data` field | Contents |
|-----------|--------------|----------|
| Multiple profiles in `.eacli-profiles.json` | `profiles` | `{ key, name, hasSession, default }[]` — no browser login |
| Single-account `.env` | `members` | Portal linked members (legacy shape) |

Always check which field is present before parsing.

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
| `PROFILE_NOT_FOUND` | No profile matches `--profile` / `--member` |
| `PROFILE_MISMATCH` | Portal display name does not match profile (or unreadable) |
| `AMBIGUOUS_PROFILE` | Member query matches multiple profiles (e.g. shared first name) |
| `NOT_LOGGED_IN` | Login required (`login` tool or `npm run dev -- login`) |
| `SITE_ERROR` | Portal error page |
| `TIMEOUT` | Playwright timeout — retry or increase MCP timeout |

---

## Portal quirks

- **Manage Bookings layout** — The portal uses separate tables for waitlist vs confirmed bookings. `list_bookings` and `cancel_booking` parse all of them.
- **Household members** — The portal no longer switches linked members. Configure `.eacli-profiles.json` (one EA login per person). Pass `member` or `profile` on every tool so eacli logs into the right account. `list_bookings` returns only the active profile's bookings.
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