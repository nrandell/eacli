---
name: eacli
description: >-
  Everyone Active gym bookings via eacli — list members, availability, book, cancel.
  Use when the user asks to book a class, check what's on, cancel a session, or manage
  Everyone Active / eacli. Prefer eacli MCP tools; fallback to `npm run dev -- <cmd> --json`.
---

# Everyone Active CLI (eacli)

**Canonical skill for all hosts:** [skills/eacli/SKILL.md](../../../skills/eacli/SKILL.md)

**Docs:** [OPENCLAW.md](../../../OPENCLAW.md) · [AGENTS.md](../../../AGENTS.md) · [docs/agents.md](../../../docs/agents.md)

This Cursor skill is a thin pointer so project agents stay aligned with the OpenClaw skill pack under `skills/eacli/`.

## Quick rules

1. Confirm before book/cancel.
2. `list_members` first for multi-person households; pass **member** / **profile**.
3. `check_availability` always needs **activity** + **date** — use compact names (`hiit`, not `h I I t`).
4. MCP timeout ≥ 180s. On `NETWORK_ERROR`, retry once then force login.
5. Failures: `.eacli-session/last-run.log`, `last-failure.html`.

## Tools

Prefer **eacli MCP**. If unavailable:

```bash
npm run dev -- <command> [options] --json
```

See [skills/eacli/references/workflows.md](../../../skills/eacli/references/workflows.md) and [reference.md](reference.md).
