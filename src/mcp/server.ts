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
    instructions: `Everyone Active booking tools. Call list_members when the user says "me" and multiple members may exist (first names work for member param, e.g. "nick"). Call check_availability before book_class; ask the user to confirm book/cancel. Always pass activity and date to check_availability. check_availability returns alreadyBooked and bookable on each group — if alreadyBooked is true, tell the user and do NOT call book_class. In-centre classes are under Group Exercise 16+ Yrs: "combat" on Sunday → BodyCombat Sun, on Thursday → Combat Thu. For list_bookings, always use the "members" array on each booking (no singular "member" field). Each booking has status "Confirmed" or "Waiting List". list_members may be derived from Manage Bookings when the portal home switcher is unavailable. book_class returns error code ALREADY_BOOKED when appropriate. Prefer precise dates (DD/MM/YYYY) for edge-of-window classes. After book_class, verify with list_bookings; confirmed:false is not always failure.`,
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
