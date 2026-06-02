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
    version: '1.4.0',
  },
  {
    instructions: `Everyone Active booking tools. Call list_members when the user says "me" and multiple members may exist. Call check_availability before book_class; ask the user to confirm book/cancel. Always pass activity and date to check_availability. For list_bookings, always use the "members" array on each booking to say who is booked on that session (there is no singular "member" field). Only say multiple people are on a class when "members" has more than one name. list_bookings follows Manage Bookings pagination and collects across household context for better recurring/multi-member coverage, but remains best-effort — re-check with list_members + targeted availability if a retry loop depends on perfect state. For household cron jobs booking multiple linked members, call book_class once per member with an explicit member param; call list_bookings between retries to verify state.

Known portal quirks (esp. for linked members like Hayley as the selected/secondary): QuickBook/fav paths to class status can return sessions:[] + pageMessage "You're booking on behalf of X" even when slots exist (browse path usually succeeds). The tools now auto-fallback on empty + "on behalf"/"already booked" messages. Always pass full explicit member name. Prefer precise dates (DD/MM/YYYY or YYYY-MM-DD) inside the booking window over natural "next thursday" (vague dates often pick instances not yet visible/publish in default view). book_class returns confirmed:false on heuristic miss/race — always verify with list_bookings (and optionally check_availability) after; last-book-result.html is saved for the attempt.`,
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
