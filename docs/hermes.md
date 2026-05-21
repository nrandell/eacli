# Using eacli with [Hermes Agent](https://hermes-agent.nousresearch.com/)

Hermes is an autonomous agent from [Nous Research](https://nousresearch.com/) that can call external tools via **MCP** (Model Context Protocol). eacli ships an MCP server so Hermes can list bookings, check availability, book, and cancel on Everyone Active — from Telegram, Discord, CLI, or other channels Hermes supports.

Official Hermes MCP docs:

- [Use MCP with Hermes](https://hermes-agent.nousresearch.com/docs/guides/use-mcp-with-hermes)
- [MCP config reference](https://hermes-agent.nousresearch.com/docs/reference/mcp-config-reference)

Throughout this guide, **`<EACLI_ROOT>`** means the absolute path to your clone of this repository (the folder containing `package.json`).

## Prerequisites

1. **Install Hermes** (on the machine that will run bookings):

   ```bash
   curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash
   hermes setup
   ```

2. **Install eacli** on the **same machine** Hermes uses for MCP stdio servers:

   ```bash
   git clone <your-repo-url> eacli
   cd eacli
   npm install
   npx playwright install chromium
   cp .env.example .env
   # Edit .env with your Everyone Active email and password
   npm run build
   chmod +x bin/run-mcp.sh
   ```

3. **Log in once** (creates `.eacli-auth-state.json` in the repo):

   ```bash
   npm run dev -- doctor
   npm run dev -- login
   ```

   The first login may open a visible browser window. Use Hermes **`terminal.backend: local`** for this step unless Playwright and a display are available inside your sandbox.

## Connect eacli MCP to Hermes

Hermes reads MCP servers from `~/.hermes/config.yaml`. Stdio servers are subprocesses Hermes starts when needed.

### Recommended: wrapper script (sets repo directory)

Hermes does not always set `cwd` for MCP subprocesses. Use the included wrapper so `.env` and the session file are found:

```yaml
# ~/.hermes/config.yaml
mcp_servers:
  eacli:
    command: "<EACLI_ROOT>/bin/run-mcp.sh"
    args: []
    timeout: 180
    connect_timeout: 60
    tools:
      resources: false
      prompts: false
```

Replace `<EACLI_ROOT>` with your clone path (for example `~/eacli` expanded to a full path, or `/opt/eacli`).

Put **Everyone Active credentials** in `<EACLI_ROOT>/.env` (the wrapper loads them). Do not commit `.env`.

Alternatively, pass secrets via Hermes (from `~/.hermes/.env`):

```yaml
mcp_servers:
  eacli:
    command: "<EACLI_ROOT>/bin/run-mcp.sh"
    args: []
    env:
      USERNAME: "${EA_USERNAME}"
      PASSWORD: "${EA_PASSWORD}"
```

Then in `~/.hermes/.env`:

```bash
EA_USERNAME=your-email@example.com
EA_PASSWORD=your-password
```

### Alternative: npm from repo root

```yaml
mcp_servers:
  eacli:
    command: "bash"
    args: ["-lc", "cd <EACLI_ROOT> && npm run mcp"]
    timeout: 180
    tools:
      resources: false
      prompts: false
```

Reload MCP after editing config (in a Hermes chat):

```text
/reload-mcp
```

## Tool names in Hermes

Hermes prefixes MCP tools: `mcp_<server>_<tool>`.

With `server_name: eacli`, you get tools such as:

| Hermes tool name | Purpose |
|------------------|---------|
| `mcp_eacli_list_members` | Linked members on the account |
| `mcp_eacli_list_bookings` | Upcoming bookings |
| `mcp_eacli_list_favourites` | QuickBook favourites |
| `mcp_eacli_check_availability` | Slots for one activity + date |
| `mcp_eacli_book_class` | Book after you confirm |
| `mcp_eacli_cancel_booking` | Cancel after you confirm |
| `mcp_eacli_login` | Force re-login |
| `mcp_eacli_doctor` | Check `.env`, session, Playwright (no EA login) |

Each tool returns **JSON text** with `{ "ok", "command", "data" }` or `{ "ok": false, "error": { "message", "code" } }`.

Optional allowlist (safer for messaging channels):

```yaml
mcp_servers:
  eacli:
    command: "<EACLI_ROOT>/bin/run-mcp.sh"
    tools:
      include:
        - list_members
        - list_bookings
        - check_availability
        - book_class
        - cancel_booking
        - doctor
        - login
      resources: false
      prompts: false
```

Use the **original** tool names in `include` / `exclude`, not the `mcp_eacli_` prefix ([Hermes docs](https://hermes-agent.nousresearch.com/docs/reference/mcp-config-reference)).

## Teach Hermes how to behave

Hermes does not load Cursor’s `.cursor/skills/eacli/`. Add booking rules to agent context, for example in `~/.hermes/SOUL.md`:

```markdown
## Everyone Active (eacli MCP)

When the user asks to book, cancel, or check gym classes:

1. Call `mcp_eacli_list_members` when they say "me" / "my booking".
2. If exactly one member, use them; if several, ask who to book for.
3. Call `mcp_eacli_check_availability` with **activity** and **date** before booking.
4. Always ask the user to confirm before `mcp_eacli_book_class` or `mcp_eacli_cancel_booking`.
5. Dates: saturday, next sunday, 2026-05-25, 25/05/2026.
6. On NOT_LOGGED_IN errors, tell the user to run login once from the eacli repo: `npm run dev -- login`.
7. For `mcp_eacli_list_bookings`, summarize per class session and list who is booked using each booking's **members** array. Only say both people are on a class when `members` has two names.
```

See also [`.cursor/skills/eacli/SKILL.md`](../.cursor/skills/eacli/SKILL.md) for the full workflow (same logic).

## Example conversations

**List bookings**

> What am I booked into this week?

Hermes should call `mcp_eacli_list_bookings` and summarize `data.bookings`, listing who is on each session via the `members` array.

**Check availability**

> Is there combat on Sunday?

Hermes should call `mcp_eacli_check_availability` with `activity: "combat"`, `date: "sunday"`.

**Book (with confirmation)**

> Book me onto combat next sunday

1. `mcp_eacli_list_members`
2. Resolve member (ask if multiple)
3. `mcp_eacli_check_availability` — `activity: combat`, `date: next sunday`
4. Reply with slot and ask for confirmation
5. After user confirms → `mcp_eacli_book_class`

**Cancel**

> Cancel my combat on Thursday

1. `mcp_eacli_list_bookings` (optional)
2. Confirm with user
3. `mcp_eacli_cancel_booking` — `activity: combat`, `date: thursday`, `member` if needed

## Terminal backend notes

| Backend | eacli suitability |
|---------|-------------------|
| **local** | Best. Playwright uses local Chromium; session file stays in the repo. |
| **docker** | Possible if the repo is mounted, `.env` is available, and Playwright ran inside the image. First login is harder. |
| **modal / ssh / cloud** | Only if that environment has the repo, Node, Playwright browsers, and network access to Everyone Active. |

For most users: run Hermes with **`terminal.backend: local`** on a machine where eacli is installed.

## Multi-member cron jobs

When booking the same class for multiple linked members (e.g. a household cron):

1. Call `mcp_eacli_list_members` once to get exact names.
2. Call `mcp_eacli_book_class` **once per member** with an explicit `member` parameter (same `activity` and `date`).
3. Each call launches Playwright separately — expect **30–90 seconds per member**. Two members typically need **3–4 minutes** wall time; set Hermes `timeout: 180` or higher.
4. After a failure (`TIMEOUT`, `MEMBER_SWITCH_FAILED`, or `NO_SESSION`), call `mcp_eacli_list_bookings` before retrying to see who is already booked. Do not retry in a tight loop.
5. On `MEMBER_SWITCH_FAILED`, verify the portal manually once; a follow-up `book_class` call usually succeeds after the member slider state settles.

## Troubleshooting

| Problem | What to do |
|---------|------------|
| MCP server fails to start | `npm run dev -- doctor` in the repo; check `bin/run-mcp.sh` is executable and paths use `<EACLI_ROOT>`. |
| `NOT_LOGGED_IN` | `cd <EACLI_ROOT> && npm run dev -- login` |
| `SITE_ERROR` | Portal error page; try `login` again or `--debug` on CLI. |
| Booking slow | Each MCP call launches Playwright; expect 30–90s per book/cancel. Increase `timeout` in Hermes MCP config. |
| Wrong member booked | Always `list_members` first when multiple people are on the account. |
| Second member fails / MCP unreachable | Ensure `timeout: 180`; avoid rapid retries; call `list_bookings` between attempts. Check for orphaned Chromium processes after failures (`pgrep -fl chromium`). |
| `MEMBER_SWITCH_FAILED` | Member slider did not update; retry once after a few seconds or book manually in the portal. |
| `TIMEOUT` | Portal or Playwright was slow; increase MCP timeout or retry after checking `list_bookings`. |

## CLI fallback (no MCP)

From the repo:

```bash
npm run dev -- bookings list --json
npm run dev -- availability list --activity combat --date sunday --json
```

Hermes can also run these via its **terminal** tool if MCP is not configured. Tool schemas: [`docs/tools.json`](tools.json).
