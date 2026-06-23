import { z } from 'zod/v4';

export const profileParam = z
  .string()
  .optional()
  .describe(
    'Login profile key from .eacli-profiles.json (e.g. "nick", "hayley"). Each profile is a separate EA account. Omit to use the default profile.'
  );

export const memberParam = z
  .string()
  .optional()
  .describe(
    'Member name — partial match works (e.g. "nick" → Nick Randell). With multiple profiles configured, this selects which login to use. Required for book_class when multiple profiles exist.'
  );

export const activityParam = z
  .string()
  .describe(
    'Activity name (partial match), e.g. hiit, combat, bodycombat. In-centre classes use Group Exercise 16+ Yrs: "combat" on Sunday maps to BodyCombat Sun, on Thursday to Combat Thu. Virtual classes are prefixed "Vir".'
  );

export const dateParam = z
  .string()
  .describe(
    'Session date: natural language (saturday, next sunday, today) or ISO (2026-05-25) or UK (25/05/2026). Prefer explicit DD/MM/YYYY or YYYY-MM-DD for reliability and edge-of-window classes.'
  );

export const toolInputShapes = {
  list_members: {},
  list_bookings: { profile: profileParam, member: memberParam },
  list_favourites: { profile: profileParam, member: memberParam },
  check_availability: {
    activity: activityParam,
    date: dateParam,
    profile: profileParam,
    member: memberParam,
  },
  book_class: {
    activity: activityParam,
    date: dateParam,
    profile: profileParam,
    member: memberParam,
  },
  cancel_booking: {
    activity: activityParam,
    date: dateParam,
    profile: profileParam,
    member: memberParam,
  },
  login: {
    force: z.boolean().optional().describe('Force a fresh login even if session exists'),
    profile: profileParam,
    member: memberParam,
  },
  doctor: {},
} as const;

export const toolInputSchemas = {
  list_members: z.object({}),
  list_bookings: z.object(toolInputShapes.list_bookings),
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
  'Dates accept saturday, next sunday, today, 2026-05-25, or 25/05/2026. Prefer explicit DD/MM/YYYY or YYYY-MM-DD over natural language for edge-of-window classes.';

const PROFILE_HINT =
  'Household members need separate EA logins in .eacli-profiles.json — pass member or profile to select whose account to use. The portal member switcher no longer works.';

export const TOOL_METAS: ToolMeta[] = [
  {
    name: 'list_members',
    description: `List bookable household members. **Response shape (v1.5+):** when multiple profiles exist in .eacli-profiles.json, returns \`data.profiles\` (array of { key, name, hasSession, default }) without logging in. Single-account .env setups still return \`data.members\` (portal linked members). ${PROFILE_HINT} Call this first when the user says "me" or "book for me" and multiple people may exist.`,
    inputSchema: toolInputSchemas.list_members,
  },
  {
    name: 'list_bookings',
    description: `List upcoming bookings for the active profile only (one EA login). ${PROFILE_HINT} Pass member or profile to switch. Each booking has a members array and status "Confirmed" or "Waiting List".`,
    inputSchema: toolInputSchemas.list_bookings,
  },
  {
    name: 'list_favourites',
    description: `List QuickBook favourite activities for the active profile. ${PROFILE_HINT}`,
    inputSchema: toolInputSchemas.list_favourites,
  },
  {
    name: 'check_availability',
    description: `Check bookable or waitlist slots for in-centre Group Exercise 16+ Yrs classes. Always pass activity and date. ${DATE_HINT} ${PROFILE_HINT} Response groups include alreadyBooked and bookable.`,
    inputSchema: toolInputSchemas.check_availability,
  },
  {
    name: 'book_class',
    description: `Book an in-centre Group Exercise class for the active profile. ${DATE_HINT} ${PROFILE_HINT} Requires user confirmation after check_availability. Pass member or profile explicitly when multiple household members exist. Returns ALREADY_BOOKED when appropriate.`,
    inputSchema: toolInputSchemas.book_class,
  },
  {
    name: 'cancel_booking',
    description: `Cancel an existing booking for the active profile. ${DATE_HINT} ${PROFILE_HINT} Requires user confirmation.`,
    inputSchema: toolInputSchemas.cancel_booking,
  },
  {
    name: 'login',
    description: `Force login to Everyone Active for a profile. ${PROFILE_HINT} Run once per profile after setup. Uses credentials from .eacli-profiles.json or .env (default profile).`,
    inputSchema: toolInputSchemas.login,
  },
  {
    name: 'doctor',
    description: 'Check local setup: profiles or .env credentials, per-profile session files, Playwright install. No browser login.',
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