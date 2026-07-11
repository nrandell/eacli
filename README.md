# eacli

Command-line tool to manage **Everyone Active** gym bookings via the official Connect portal ([book.everyoneactive.com](https://book.everyoneactive.com/Connect/)). It uses **Playwright** to log in, reuse your session, and book or cancel **Group Exercise** classes.

Designed for personal use and for **AI agents** ([OpenClaw](https://docs.openclaw.ai/), Cursor, Hermes, etc.) via **MCP** or **`--json`** output.

**Agents:** start with **[OPENCLAW.md](OPENCLAW.md)** (OpenClaw), **[AGENTS.md](AGENTS.md)**, **[skills/eacli/SKILL.md](skills/eacli/SKILL.md)**, and **[docs/agents.md](docs/agents.md)** — setup, workflows, and portal quirks live in the repo.

## Requirements

- **Node.js** 18 or newer
- **npm**
- Chromium for Playwright (`npx playwright install chromium`)
- An Everyone Active account with online booking enabled

## Install

### From source (recommended)

```bash
git clone <your-repo-url> eacli
cd eacli

npm install
npx playwright install chromium

cp .env.example .env
# Edit .env: USERNAME and PASSWORD for Everyone Active

npm run build          # compiles TypeScript to dist/
chmod +x bin/run-mcp.sh   # MCP wrapper (OpenClaw, Hermes, etc.)
```

### Verify and log in

```bash
npm run dev -- doctor          # .env, session file, Playwright
npm run dev -- login           # first time: may open a browser
npm run dev -- bookings list   # upcoming classes
```

### Optional: global `eacli` command

After `npm run build`:

```bash
npm link
eacli bookings list
eacli doctor --json
```

Or without linking:

```bash
npm start -- bookings list
node dist/index.js bookings list
```

## Configuration

| File | Purpose |
|------|---------|
| [`.env`](.env.example) | Single-account `USERNAME` and `PASSWORD` (gitignored) |
| [`.eacli-profiles.example.json`](.eacli-profiles.example.json) | Template for household members with separate EA logins |
| `.eacli-profiles.json` | Per-person credentials + display names (gitignored) |
| `.eacli-session/auth-<profile>.json` | Saved login cookies per profile (gitignored) |
| `.eacli-auth-state.json` | Legacy session file for default profile (gitignored) |
| `.eacli-session/` | Debug HTML/screenshots when using `--debug` (gitignored) |

**Household setup** (portal member switcher removed — each person logs in separately):

```bash
cp .eacli-profiles.example.json .eacli-profiles.json
# Edit credentials and names, then log in once per profile:
npm run dev -- login --profile nick
npm run dev -- login --profile hayley
npm run dev -- book --member hayley --activity combat --date 2026-06-30
```

Never commit `.env`, `.eacli-profiles.json`, session files, or real credentials.

## Commands

| Command | Description |
|---------|-------------|
| `members` / `profiles list` | Configured login profiles (household) or portal linked members |
| `bookings list` | Upcoming bookings |
| `bookings cancel --activity <name> --date <date>` | Cancel a booking (`--member` optional) |
| `availability list` | Available / waitlist slots |
| `book --member <name> --activity <name> --date <date>` | Book a class |
| `favourites list` | QuickBook favourites |
| `login` | Force fresh login |
| `doctor` | Local setup check (no portal login) |

**Dates** accept natural language (`saturday`, `next sunday`, `today`) or `2026-05-25` or `25/05/2026`.

**Activities** are partial matches (`hiit`, `combat`, `bodycombat`).

Add `--debug` for verbose logs and HTML dumps in `.eacli-session/`.

### Examples

See **[docs/examples.md](docs/examples.md)** for copy-paste commands and sample JSON.

```bash
npm run dev -- availability list --activity combat --date "next sunday"
npm run dev -- book --member Alex --activity combat --date "next sunday"
npm run dev -- bookings cancel --activity hiit --date saturday --member Alex
```

## JSON output (scripts and agents)

Pass **`--json`** on any command. **Stdout** is a single JSON object (no chalk tables).

```bash
npm run dev -- members --json
npm run dev -- availability list --activity combat --date sunday --json
```

```json
{ "version": 1, "ok": true, "command": "members", "data": { "members": [ ... ] } }
```

```json
{ "version": 1, "ok": false, "command": "book", "error": { "message": "...", "code": "NO_SESSION" } }
```

OpenAI-style tool definitions (shell agents): **[docs/tools.json](docs/tools.json)** — regenerate with `npm run generate-tools`.

## AI agents (OpenClaw, Cursor, MCP)

**[AGENTS.md](AGENTS.md)** — short rules for any agent host.

**[docs/agents.md](docs/agents.md)** — full guide: OpenClaw `mcp add`, Cursor config, workflows, JSON shapes, troubleshooting.

Quick OpenClaw setup (after install + `login`):

```bash
openclaw mcp add eacli --command <EACLI_ROOT>/bin/run-mcp.sh --timeout 180
openclaw mcp doctor eacli --probe
```

MCP tools: `list_members`, `list_bookings`, `check_availability`, `book_class`, `cancel_booking`, `login`, `doctor`.

Cursor also has [`.cursor/skills/eacli/SKILL.md`](.cursor/skills/eacli/SKILL.md) (points at `docs/agents.md`). Hermes users: **[docs/hermes.md](docs/hermes.md)**.

## Build and development

| Script | Purpose |
|--------|---------|
| `npm run dev -- <cmd>` | Run CLI via tsx (no build step) |
| `npm run build` | Compile `src/` → `dist/` |
| `npm start -- <cmd>` | Run compiled `dist/index.js` |
| `npm run mcp` | MCP server on stdio |
| `npm run generate-tools` | Refresh `docs/tools.json` |

Project layout:

- `src/index.ts` — CLI entry
- `src/mcp/server.ts` — MCP server
- `src/booking.ts`, `src/cancelBooking.ts`, `src/availability.ts`, … — portal automation

## Limitations

- **Group Exercise** classes via Connect “Make a Booking” / QuickBook (not swim lanes, courts, etc.).
- **Cancellation** uses the portal “Manage Bookings” page.
- Portal HTML changes can break parsers; use `--debug` and report issues.
- Each MCP/CLI call currently starts a fresh browser session (can take 30–90s per book/cancel).
- Respect Everyone Active’s cancellation and no-show policies on their site.

## npm publish?

**Not required** for personal or Hermes use: clone the repo and point MCP at it. Publishing to npm is optional if you want `npm install -g` without cloning; Playwright and `.env` setup would still be documented for end users.

## License

ISC
