# OpenClaw + eacli

**Start here** if you are an OpenClaw (or similar) agent booking Everyone Active classes with this repo.

| Resource | Purpose |
|----------|---------|
| **This file** | Setup + quick playbook |
| [`AGENTS.md`](AGENTS.md) | Short hard rules |
| [`skills/eacli/SKILL.md`](skills/eacli/SKILL.md) | Portable agent skill (workflows, pitfalls) |
| [`docs/agents.md`](docs/agents.md) | Full canonical guide (JSON shapes, quirks) |
| [`docs/tools.json`](docs/tools.json) | Shell tool schemas if MCP is unavailable |

`<EACLI_ROOT>` = absolute path to this directory (contains `package.json`).

---

## Install (human, once)

```bash
cd <EACLI_ROOT>
npm install
npx playwright install chromium
cp .eacli-profiles.example.json .eacli-profiles.json   # or .env for single user
# edit credentials
npm run dev -- login --profile nick
npm run dev -- login --profile hayley   # if multi-profile
npm run dev -- doctor --json
```

## MCP (recommended)

```bash
chmod +x <EACLI_ROOT>/bin/run-mcp.sh

openclaw mcp add eacli \
  --command <EACLI_ROOT>/bin/run-mcp.sh \
  --timeout 180 \
  --connect-timeout 30

openclaw mcp reload
```

**Timeout must be ≥ 180s.** Playwright operations often take 30–90s; network retries can take longer.

## Skill

Install/load [`skills/eacli`](skills/eacli) into OpenClaw’s skills path (symlink or copy).  
The skill teaches when to book, which tools to call, activity naming (`hiit` not `h I I t`), and how to diagnose failures.

---

## Agent playbook (do this)

### Book HIIT for Nick next Saturday

1. `list_members` → confirm profile/member (`nick`)
2. `check_availability` — `activity: "hiit"`, `date: "next-saturday"`, `member: "nick"`
3. Confirm with user (class, date, time, person)
4. `book_class` — same args
5. `list_bookings` — `member: "nick"` to verify (`members[]`, `status`)

### Activity names

Use compact queries: **`hiit`**, **`combat`**, **`bodycombat`**.  
Portal UI shows spaced labels like `H I I T Sat 08:25` — do **not** pass day/time as the activity unless you mean a full label match.

### Household

Each person needs their own EA login in `.eacli-profiles.json`. Always pass **`member`** or **`profile`**.  
`list_bookings` is **per active profile only**.

### Safety

- Confirm before book/cancel  
- Always pass **activity + date** to availability  
- `confirmed: false` → verify with `list_bookings` before retry  

---

## When things fail

| Code / symptom | Action |
|----------------|--------|
| `NETWORK_ERROR` / `net::ERR_*` | Wait, retry once; check VPN/Wi‑Fi; then force `login` |
| Hang / no progress | Allow up to 180s; watch stderr `[eacli]` phases; see `last-run.log` |
| `ACTIVITY_NOT_FOUND` + empty list | Network/session — retry, force login, inspect `last-failure.html` |
| `NOT_LOGGED_IN` | `login` with `force: true` for that profile |
| Unclear | `doctor` + read `.eacli-session/last-run.log` |

### Log locations (always written on failure)

```
.eacli-session/last-run.log          # latest run (also mirrored per-command under logs/)
.eacli-session/logs/*.log            # one file per command
.eacli-session/last-failure.html     # portal HTML snapshot
.eacli-session/last-failure.png      # screenshot when possible
```

JSON errors may include `error.logPath` and `error.artifacts`.

---

## CLI fallback (no MCP)

From `<EACLI_ROOT>`, always **`--json`**. Progress is on **stderr**; JSON on **stdout**.

```bash
npm run dev -- members --json
npm run dev -- availability list --activity hiit --date next-saturday --member nick --json
npm run dev -- book --member nick --activity hiit --date next-saturday --json
npm run dev -- bookings list --member nick --json
npm run dev -- doctor --json
```

---

## Version

eacli **1.6.0+**: navigation retries, `NETWORK_ERROR`, always-on run logs, OpenClaw skill pack.
