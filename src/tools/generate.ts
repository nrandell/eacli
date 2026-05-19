#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { getOpenAIToolDefinitions } from './schema.js';

const outPath = path.resolve('docs/tools.json');
const payload = {
  description: 'OpenAI-style tool definitions for eacli (shell agents without MCP)',
  version: 1,
  cliPrefix: 'npm run dev --',
  globalFlags: ['--json'],
  tools: getOpenAIToolDefinitions(),
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`);
console.error(`Wrote ${outPath}`);
