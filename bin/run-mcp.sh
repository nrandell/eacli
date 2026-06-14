#!/usr/bin/env bash
# Wrapper for OpenClaw, Hermes, and other MCP hosts that do not set a working directory.
# Resolves to the eacli repo root and starts the MCP server on stdio.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi
exec npm run mcp --silent
