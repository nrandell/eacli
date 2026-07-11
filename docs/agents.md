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

**First stop for OpenClaw:** [../OPENCLAW.md](../OPENCLAW.md) and the portable skill [../skills/eacli/SKILL.md](../skills/eacli/SKILL.md).

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

1. Load **[../skills/eacli/SKILL.md](../skills/eacli/SKILL.md)** (symlink/copy into OpenClaw skills path — see skill `references/openclaw-setup.md`).
2. Prefer **MCP tools** over shell exec; if shell is required, always `--json` from `<EACLI_ROOT>`.
3. Activity queries: **`hiit`**, **`combat`** — not spaced portal labels (`h I I t`). Portal may show `H I I T Sat 08:25`.
4. On `NETWORK_ERROR`: wait, retry once, then force `login` + `doctor`. Read `.eacli-session/last-run.log`.
5. Progress appears on stderr as `[eacli] …` during long Playwright runs (do not kill under ~180s).

Also point the agent at:

- **[../OPENCLAW.md](../OPENCLAW.md)** — setup + playbook  
- **[../AGENTS.md](../AGENTS.md)** — short rules  
- **This file** — JSON shapes and portal quirks  

Cursor’s `.cursor/skills/` is not loaded by OpenClaw; use `skills/eacli/` instead.

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
| `ACTIVITY_NOT_FOUND` | Activity not in Group Exercise list (or activity list page empty) |
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
| `NETWORK_ERROR` | Transient Chromium network failure (`net::ERR_*`) — wait and retry once |

Errors may include optional **`logPath`** and **`artifacts`** pointing at `.eacli-session/` diagnostics.

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
| `NETWORK_ERROR` | Wait a few seconds; retry once; check VPN/Wi‑Fi; force login if repeated |
| Slow / `TIMEOUT` | Increase MCP timeout to 180s+; avoid rapid retries |
| Wrong member on booking | Pass explicit `member`; call `list_members` first |
| Missing bookings | Re-run `list_bookings`; inspect `.eacli-session/` HTML dumps |
| Empty activity list | See `last-failure.html`; retry / force login — often network or stale session |
| MCP can't find `.env` | Use `bin/run-mcp.sh` or set `--cwd <EACLI_ROOT>` |

### Always-on diagnostics (v1.6+)

| Path | Content |
|------|---------|
| `.eacli-session/last-run.log` | Latest command log (phases, URLs, errors) |
| `.eacli-session/logs/*.log` | Per-command logs |
| `.eacli-session/last-failure.html` | Portal HTML at failure |
| `.eacli-session/last-failure.png` | Screenshot when available |

`doctor` reports last-run / last-failure pointers and Playwright version.

```bash
DEBUG=1 npm run dev -- bookings list --json
cat .eacli-session/last-run.log
```