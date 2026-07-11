#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import dotenv from 'dotenv';
import { executeTool } from './execute.js';
import { TOOL_METAS, toolInputShapes, type ToolName } from '../tools/schema.js';
import type { EacliResponse } from '../output.js';

dotenv.config({ quiet: true });

function toolTextResult(response: EacliResponse<unknown>) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
    isError: !response.ok,
  };
}

const server = new McpServer(
  {
    name: 'eacli',
    version: '1.6.0',
  },
  {
    instructions: `Everyone Active booking tools (timeout ≥ 180s). Prefer MCP over shell. Household: separate EA logins in .eacli-profiles.json — pass member or profile (first names ok, e.g. "hayley"). Workflow: list_members → check_availability (always pass activity + date) → user confirm → book_class → verify with list_bookings. Activity queries: use compact names like "hiit" or "combat" (not spaced portal labels "h I I t"); portal may show "H I I T Sat 08:25". If alreadyBooked is true, do NOT book. confirmed:false is not always failure — check list_bookings. On NETWORK_ERROR or timeout: wait a few seconds and retry once; then login(force) + doctor. On failure, read error.logPath and .eacli-session/last-run.log / last-failure.html. Docs: OPENCLAW.md, AGENTS.md, skills/eacli/SKILL.md.`,
  }
);

for (const meta of TOOL_METAS) {
  const shape = toolInputShapes[meta.name];
  const hasInputs = Object.keys(shape).length > 0;
  server.registerTool(
    meta.name,
    {
      description: meta.description,
      ...(hasInputs ? { inputSchema: shape } : {}),
    },
    async (args: Record<string, unknown>) => {
      const response = await executeTool(meta.name as ToolName, args ?? {});
      return toolTextResult(response);
    }
  );
}

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
