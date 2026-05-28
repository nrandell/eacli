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
    version: '1.2.1',
  },
  {
    instructions: `Everyone Active booking tools. Call list_members when the user says "me" and multiple members may exist. Call check_availability before book_class; ask the user to confirm book/cancel. Always pass activity and date to check_availability. For list_bookings, use each booking's members array to say who is booked on that session; only list multiple people when members has more than one name. list_bookings now follows Manage Bookings pagination and collects across household context for better recurring/multi-member coverage, but remains best-effort—re-check with list_members + targeted availability if a retry loop depends on perfect state. For household cron jobs booking multiple linked members, call book_class once per member with an explicit member param; call list_bookings between retries to verify state.`,
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
