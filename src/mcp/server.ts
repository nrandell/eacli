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
    version: '1.0.0',
  },
  {
    instructions: `Everyone Active booking tools. Call list_members when the user says "me" and multiple members may exist. Call check_availability before book_class; ask the user to confirm book/cancel. Always pass activity and date to check_availability.`,
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
