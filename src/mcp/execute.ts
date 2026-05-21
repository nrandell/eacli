import type { Page } from 'playwright';
import { closeAuthenticated, getAuthenticatedContext, type AuthResult } from '../auth.js';
import { bookClass } from '../booking.js';
import { cancelBooking } from '../cancelBooking.js';
import { getBookings } from '../bookings.js';
import { runDoctor } from '../doctor.js';
import { getFavourites } from '../favourites.js';
import { listAvailability } from '../availability.js';
import { getMembers } from '../members.js';
import {
  EacliCommandError,
  errorResponse,
  mapErrorFromThrowable,
  successResponse,
  type EacliResponse,
} from '../output.js';
import type { ToolName } from '../tools/schema.js';
import { toolInputSchemas } from '../tools/schema.js';

async function withAuthenticatedPage<T>(
  command: string,
  fn: (page: Page) => Promise<T>
): Promise<EacliResponse<T>> {
  let auth: AuthResult | undefined;
  try {
    auth = await getAuthenticatedContext();
    const data = await fn(auth.page);
    return successResponse(command, data);
  } catch (err: unknown) {
    return errorResponse(command, mapErrorFromThrowable(err));
  } finally {
    if (auth) await closeAuthenticated(auth).catch(() => {});
  }
}

export async function executeTool(
  name: ToolName,
  args: unknown
): Promise<EacliResponse<unknown>> {
  const schema = toolInputSchemas[name];
  const parsed = schema.safeParse(args ?? {});
  if (!parsed.success) {
    return errorResponse(name, {
      message: parsed.error.message,
      code: 'VALIDATION_ERROR',
    });
  }

  const input = parsed.data;

  switch (name) {
    case 'list_members':
      return withAuthenticatedPage(name, async (page) => ({
        members: await getMembers(page),
      }));

    case 'list_bookings':
      return withAuthenticatedPage(name, async (page) => ({
        bookings: await getBookings(page),
      }));

    case 'list_favourites': {
      const { member } = input as { member?: string };
      return withAuthenticatedPage(name, async (page) => {
        let favourites = await getFavourites(page);
        if (member?.trim()) {
          const q = member.trim().toLowerCase();
          favourites = favourites.filter((f) => f.member?.toLowerCase().includes(q));
        }
        return { favourites };
      });
    }

    case 'check_availability': {
      const { activity, date, member } = input as {
        activity: string;
        date: string;
        member?: string;
      };
      return withAuthenticatedPage(name, (page) =>
        listAvailability(page, {
          activity,
          date,
          ...(member ? { memberName: member } : {}),
        })
      );
    }

    case 'book_class': {
      const { activity, date, member } = input as {
        activity: string;
        date: string;
        member?: string;
      };
      return withAuthenticatedPage(name, async (page) => {
        let memberName = member?.trim();
        if (!memberName) {
          const members = await getMembers(page);
          if (members.length === 1) {
            memberName = members[0]!.name;
          } else {
            throw new EacliCommandError(
              'member is required when multiple linked members exist — call list_members first',
              'VALIDATION_ERROR'
            );
          }
        }
        return bookClass(page, { memberName, activity, date });
      });
    }

    case 'cancel_booking': {
      const { activity, date, member } = input as {
        activity: string;
        date: string;
        member?: string;
      };
      return withAuthenticatedPage(name, (page) =>
        cancelBooking(page, {
          activity,
          date,
          ...(member ? { memberName: member } : {}),
        })
      );
    }

    case 'login': {
      const { force } = input as { force?: boolean };
      try {
        const auth = await getAuthenticatedContext({ forceLogin: Boolean(force) });
        await closeAuthenticated(auth);
        return successResponse(name, { loggedIn: true });
      } catch (err: unknown) {
        return errorResponse(name, mapErrorFromThrowable(err));
      }
    }

    case 'doctor': {
      try {
        const result = await runDoctor();
        return successResponse(name, result);
      } catch (err: unknown) {
        return errorResponse(name, mapErrorFromThrowable(err));
      }
    }

    default:
      return errorResponse(name, { message: `Unknown tool: ${name}`, code: 'UNKNOWN' });
  }
}
