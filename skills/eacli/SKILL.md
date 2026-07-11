---
name: eacli
description: >
  Everyone Active gym bookings via eacli (MCP + CLI). Use when the user asks to book a class,
  check availability, list or cancel bookings, or manage Nick/Hayley (or other household)
  Everyone Active sessions. Prefer MCP tools; fall back to npm run dev -- … --json.
---

# eacli — Everyone Active bookings

**Read first:** repo root [`OPENCLAW.md`](../../OPENCLAW.md) and [`AGENTS.md`](../../AGENTS.md).  
**Canonical detail:** [`docs/agents.md`](../../docs/agents.md).  
**This skill** is the operational playbook for OpenClaw (and any agent skills host).

## Prefer MCP over shell

| Priority | How |
|----------|-----|
| 1 | MCP tools (`list_members`, `check_availability`, `book_class`, …) with **timeout ≥ 180s** |
| 2 | CLI from repo root with **`--json`**: `npm run dev -- <cmd> --json` |

Do **not** rely on human-only CLI progress text as the only success signal — parse JSON `ok` / `error.code`.

## Hard rules

1. **Confirm** with the user before `book_class` or `cancel_booking` (activity, date, time, member).
2. **`list_members` first** when the user says “me” / “my” and multiple people may exist.
3. Pass **`member` or `profile`** on book / cancel / availability / bookings (`nick`, `hayley`, …).
4. **`check_availability`** always needs **activity** + **date** (never scan all activities).
5. Activity names: use **`hiit`**, **`combat`**, **`bodycombat`** — **not** spaced portal labels like `h I I t`.
6. After `book_class`, if `confirmed: false` → **`list_bookings`** before retrying (not always a failure).
7. On **`NETWORK_ERROR`** or hang → wait a few seconds, **retry once**, then `login` (force) + `doctor`.

## Standard workflows

### Book a class

```
list_members
  → resolve member/profile
check_availability { activity: "hiit", date: "next-saturday", member: "nick" }
  → stop if no available/waitlist slot or alreadyBooked
confirm with user
book_class { activity: "hiit", date: "next-saturday", member: "nick" }
list_bookings { member: "nick" }   # verify
```

### What’s available?

```
check_availability { activity, date, member }
```

### Cancel

```
list_bookings (optional)
confirm with user
cancel_booking { activity, date, member }
```

## Activity naming

| Do | Don’t |
|----|--------|
| `hiit` | `h I I t` |
| `combat` | Full portal string with day/time unless intentional |
| `bodycombat` | Omitting activity (full catalogue scan) |

Portal displays classes as **`H I I T Sat 08:25`**. Matching accepts spaced forms, but compact queries are more reliable for agents.

## Dates

Pass natural language through: `saturday`, `next-saturday`, `today`, `2026-07-18`, `18/07/2026`.  
Prefer explicit **DD/MM/YYYY** or **ISO** near booking-window edges.

## Failure diagnosis

Errors may include:

```json
{
  "ok": false,
  "error": {
    "code": "NETWORK_ERROR",
    "message": "...",
    "logPath": ".eacli-session/logs/....log",
    "artifacts": [".eacli-session/last-failure.html", "..."]
  }
}
```

Always check:

| Path | What |
|------|------|
| `.eacli-session/last-run.log` | Latest run (phases + errors) |
| `.eacli-session/logs/` | Per-command logs |
| `.eacli-session/last-failure.html` | Portal page at failure |
| `.eacli-session/last-failure.png` | Screenshot |
| `doctor` tool | Setup + last log pointers |

## CLI fallback (always `--json`)

From **eacli repo root** (`package.json` directory):

```bash
npm run dev -- members --json
npm run dev -- availability list --activity hiit --date next-saturday --member nick --json
npm run dev -- book --member nick --activity hiit --date next-saturday --json
npm run dev -- bookings list --member nick --json
npm run dev -- bookings cancel --member nick --activity hiit --date next-saturday --json
npm run dev -- login --profile nick --json
npm run dev -- doctor --json
```

Quote multi-word values. Progress appears on **stderr** as `[eacli] …`; JSON is on **stdout**.

## Related references

- [references/workflows.md](references/workflows.md) — step detail  
- [references/pitfalls.md](references/pitfalls.md) — network, naming, timeouts  
- [references/openclaw-setup.md](references/openclaw-setup.md) — MCP + skill install  
