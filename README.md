# eacli

Command-line tool to manage **Everyone Active** gym bookings via the official Connect portal ([book.everyoneactive.com](https://book.everyoneactive.com/Connect/)). It uses **Playwright** to log in, reuse your session, and book or cancel **Group Exercise** classes.

Designed for personal use and for **AI agents** (Cursor, [Hermes Agent](https://hermes-agent.nousresearch.com/), OpenClaw, etc.) via **MCP** or **`--json`** output.

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
chmod +x bin/run-mcp.sh   # needed for Hermes MCP wrapper
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
| [`.env`](.env.example) | `USERNAME` and `PASSWORD` (gitignored) |
| `.eacli-auth-state.json` | Saved login cookies (gitignored, created by `login`) |
| `.eacli-session/` | Debug HTML/screenshots when using `--debug` (gitignored) |

Never commit `.env`, session files, or real credentials. Only [`.env.example`](.env.example) belongs in git.

## Commands

| Command | Description |
|---------|-------------|
| `members` | Linked members who can be booked for |
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

## Hermes Agent

[Hermes](https://hermes-agent.nousresearch.com/) connects to eacli over **MCP** so you can book from Telegram, Discord, Slack, CLI, etc.

**Full guide:** **[docs/hermes.md](docs/hermes.md)**

Quick setup:

1. Install Hermes: `curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash` then `hermes setup`
2. Install eacli (above) on the **same machine** and run `login` once
3. Add to `~/.hermes/config.yaml`:

Replace `<EACLI_ROOT>` with the absolute path where you cloned this repo (e.g. expand `~/eacli` to a full path).

```yaml
mcp_servers:
  eacli:
    command: "<EACLI_ROOT>/bin/run-mcp.sh"
    args: []
    timeout: 180
    tools:
      resources: false
      prompts: false
```

4. In Hermes chat: `/reload-mcp`
5. Ask: *“What am I booked into?”* or *“Book me onto combat next sunday”* (Hermes should confirm before booking)

Hermes exposes tools as `mcp_eacli_list_members`, `mcp_eacli_check_availability`, `mcp_eacli_book_class`, etc. See the [Hermes MCP config reference](https://hermes-agent.nousresearch.com/docs/reference/mcp-config-reference).

## Cursor and other LLM hosts

### MCP (Cursor)

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

Set `cwd` to the absolute path of your clone (the directory that contains `package.json`).

Tools: `list_members`, `list_bookings`, `check_availability`, `book_class`, `cancel_booking`, `login`, `doctor`.

### Agent skill (Cursor)

[`.cursor/skills/eacli/SKILL.md`](.cursor/skills/eacli/SKILL.md) — natural-language workflows, “me” resolution, confirm before book/cancel.

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
