# eacli — agent instructions

Everyone Active gym bookings CLI + MCP server. **Read this file and [docs/agents.md](docs/agents.md) before using tools.**

## Quick rules

1. **Confirm** with the user before `book_class` or `cancel_booking` (activity, date, time, member).
2. **`list_members` first** when the user says "me" / "my" and multiple linked members may exist.
3. **`check_availability`** before booking — always pass **activity** and **date** (never scan all activities).
4. **`list_bookings`**: use each session's **`members`** array (no singular `member` field). Mention **`status`** when it is `Waiting List`.
5. **`book_class` `confirmed: false`** is not always failure — verify with `list_bookings` before retrying.
6. Set MCP **timeout ≥ 180s** — Playwright calls often take 30–90s.

## Documentation map

| Doc | Purpose |
|-----|---------|
| [docs/agents.md](docs/agents.md) | **Canonical agent guide** — OpenClaw, Cursor, MCP, workflows, pitfalls |
| [docs/examples.md](docs/examples.md) | CLI examples and sample JSON |
| [docs/tools.json](docs/tools.json) | Tool schemas for shell agents without MCP (`npm run generate-tools` to refresh) |
| [docs/hermes.md](docs/hermes.md) | Hermes-only setup (optional) |

## MCP tools

`list_members`, `list_bookings`, `list_favourites`, `check_availability`, `book_class`, `cancel_booking`, `login`, `doctor`

MCP server instructions are also embedded in [src/mcp/server.ts](src/mcp/server.ts) (loaded at runtime).

## CLI fallback (no MCP)

From repo root, always use `--json`:

```bash
npm run dev -- bookings list --json
```