import { z } from 'zod/v4';

export const memberParam = z
  .string()
  .optional()
  .describe(
    'Linked member name (partial match). Omit only when the account has exactly one linked member. If multiple members exist, you must ask the user which person to use.'
  );

export const activityParam = z
  .string()
  .describe('Activity name (partial match), e.g. hiit, combat, bodycombat');

export const dateParam = z
  .string()
  .describe(
    'Session date: natural language (saturday, next sunday, today) or ISO (2026-05-25) or UK (25/05/2026)'
  );

export const toolInputShapes = {
  list_members: {},
  list_bookings: {},
  list_favourites: { member: memberParam },
  check_availability: {
    activity: activityParam,
    date: dateParam,
    member: memberParam,
  },
  book_class: {
    activity: activityParam,
    date: dateParam,
    member: memberParam,
  },
  cancel_booking: {
    activity: activityParam,
    date: dateParam,
    member: memberParam,
  },
  login: {
    force: z.boolean().optional().describe('Force a fresh login even if session exists'),
  },
  doctor: {},
} as const;

export const toolInputSchemas = {
  list_members: z.object({}),
  list_bookings: z.object({}),
  list_favourites: z.object(toolInputShapes.list_favourites),
  check_availability: z.object(toolInputShapes.check_availability),
  book_class: z.object(toolInputShapes.book_class),
  cancel_booking: z.object(toolInputShapes.cancel_booking),
  login: z.object(toolInputShapes.login),
  doctor: z.object({}),
} as const;

export type ToolName = keyof typeof toolInputSchemas;

export interface ToolMeta {
  name: ToolName;
  description: string;
  inputSchema: (typeof toolInputSchemas)[ToolName];
}

const DATE_HINT =
  'Dates accept saturday, next sunday, today, 2026-05-25, or 25/05/2026.';

export const TOOL_METAS: ToolMeta[] = [
  {
    name: 'list_members',
    description:
      'List linked members on the Everyone Active account. Call this first when the user says "me" or "book for me" — use the sole member if only one exists; otherwise ask which member.',
    inputSchema: toolInputSchemas.list_members,
  },
  {
    name: 'list_bookings',
    description:
      'List upcoming bookings from Manage Bookings (paged + household rows). Each session has a `members` array naming who is booked on that class. Always use the `members` array (never look for a singular `member` field — it no longer exists). Multiple names means multiple people are booked on that session. One object per class session. Attribution is best-effort (GridView pagination + member context); for critical verification call `list_members` + `check_availability` per member if needed.',
    inputSchema: toolInputSchemas.list_bookings,
  },
  {
    name: 'list_favourites',
    description: 'List QuickBook favourite activities on the member home page.',
    inputSchema: toolInputSchemas.list_favourites,
  },
  {
    name: 'check_availability',
    description: `Check bookable or waitlist slots for a Group Exercise class. Always pass activity and date (do not scan all activities). ${DATE_HINT} Call before book_class and show the user available times.`,
    inputSchema: toolInputSchemas.check_availability,
  },
  {
    name: 'book_class',
    description: `Book a Group Exercise class. ${DATE_HINT} Requires user confirmation after check_availability. Books the first matching session on that day.`,
    inputSchema: toolInputSchemas.book_class,
  },
  {
    name: 'cancel_booking',
    description: `Cancel an existing booking. ${DATE_HINT} Requires user confirmation. Match by activity and date.`,
    inputSchema: toolInputSchemas.cancel_booking,
  },
  {
    name: 'login',
    description: 'Force login to Everyone Active (uses USERNAME/PASSWORD from .env). Use when session errors occur.',
    inputSchema: toolInputSchemas.login,
  },
  {
    name: 'doctor',
    description: 'Check local setup: .env credentials, saved session file, Playwright install. No browser login.',
    inputSchema: toolInputSchemas.doctor,
  },
];

/** OpenAI-style function definitions for shell-based agents. */
export function getOpenAIToolDefinitions(): Array<{
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}> {
  return TOOL_METAS.map((meta) => ({
    type: 'function' as const,
    function: {
      name: meta.name,
      description: meta.description,
      parameters: zodToJsonSchema(meta.inputSchema),
    },
  }));
}

function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodToJsonSchema(value as z.ZodType);
      if (!(value instanceof z.ZodOptional)) required.push(key);
    }
    return {
      type: 'object',
      properties,
      ...(required.length > 0 ? { required } : {}),
    };
  }
  if (schema instanceof z.ZodOptional) {
    return zodToJsonSchema(schema.unwrap() as z.ZodType);
  }
  if (schema instanceof z.ZodBoolean) {
    return { type: 'boolean', description: schema.description };
  }
  if (schema instanceof z.ZodString) {
    return { type: 'string', ...(schema.description ? { description: schema.description } : {}) };
  }
  return { type: 'string' };
}
