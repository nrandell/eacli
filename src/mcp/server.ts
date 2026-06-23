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
    version: '1.5.0',
  },
  {
    instructions: `Everyone Active booking tools. Household members use separate EA logins (.eacli-profiles.json) — pass member or profile on every command (first names work, e.g. "hayley"). Call list_members first when the user says "me" and multiple people may exist. list_bookings shows only the active profile's bookings. Call check_availability before book_class; ask the user to confirm book/cancel. Always pass activity and date to check_availability. check_availability returns alreadyBooked and bookable — if alreadyBooked is true, do NOT call book_class. In-centre classes: Group Exercise 16+ Yrs ("combat" Sunday → BodyCombat Sun, Thursday → Combat Thu). Prefer precise dates (DD/MM/YYYY). After book_class, verify with list_bookings for that member/profile; confirmed:false is not always failure.`,
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
