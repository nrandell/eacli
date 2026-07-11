# OpenClaw setup for eacli

`<EACLI_ROOT>` = absolute path to this repo (folder containing `package.json`).

## 1. Install eacli once

```bash
cd <EACLI_ROOT>
npm install
npx playwright install chromium
# Household:
cp .eacli-profiles.example.json .eacli-profiles.json   # edit credentials
npm run dev -- login --profile nick
npm run dev -- login --profile hayley
npm run dev -- doctor --json
```

## 2. MCP server (recommended)

```bash
chmod +x <EACLI_ROOT>/bin/run-mcp.sh

openclaw mcp add eacli \
  --command <EACLI_ROOT>/bin/run-mcp.sh \
  --timeout 180 \
  --connect-timeout 30

openclaw mcp doctor eacli --probe
openclaw mcp reload
```

After editing `.eacli-profiles.json`, **reload MCP**.

## 3. Skill

Point OpenClaw at this repo’s skill directory, e.g. copy or symlink:

```bash
# Example: project-local skill path used by OpenClaw (adjust to your install)
ln -sfn <EACLI_ROOT>/skills/eacli ~/.openclaw/skills/eacli
# or: copy skills/eacli into the skills path your OpenClaw instance scans
```

Ensure the agent can also **read** `<EACLI_ROOT>/OPENCLAW.md` and `AGENTS.md` when working on bookings.

## 4. Timeouts

| Setting | Value |
|---------|--------|
| MCP tool timeout | **≥ 180** seconds |
| Connect timeout | 30–60s |

Playwright book/availability often needs 30–90s; network retries can add more.

## 5. Diagnose failures

```bash
cd <EACLI_ROOT>
npm run dev -- doctor --json
cat .eacli-session/last-run.log
# optional: open last-failure.html in a browser
```

Error JSON may include `logPath` and `artifacts` for the failing call.
