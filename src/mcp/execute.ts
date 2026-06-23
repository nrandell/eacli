import type { Page } from 'playwright';
import { closeAuthenticated, getAuthenticatedContext, type AuthOptions, type AuthResult } from '../auth.js';
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
import { hasMultipleProfiles, listProfileSummaries, type ResolvedProfile } from '../profiles.js';
import type { ToolName } from '../tools/schema.js';
import { toolInputSchemas } from '../tools/schema.js';

async function withAuthenticatedPage<T>(
  command: string,
  authOptions: AuthOptions,
  fn: (page: Page, profile: ResolvedProfile) => Promise<T>
): Promise<EacliResponse<T>> {
  let auth: AuthResult | undefined;
  try {
    auth = await getAuthenticatedContext(authOptions);
    const data = await fn(auth.page, auth.profile);
    return successResponse(command, data);
  } catch (err: unknown) {
    return errorResponse(command, mapErrorFromThrowable(err));
  } finally {
    if (auth) await closeAuthenticated(auth).catch(() => {});
  }
}

function authOptionsFromInput(input: {
  profile?: string | undefined;
  member?: string | undefined;
  requireExplicit?: boolean | undefined;
  forceLogin?: boolean | undefined;
}): AuthOptions {
  const options: AuthOptions = {};
  if (input.profile?.trim()) options.profile = input.profile.trim();
  if (input.member?.trim()) options.member = input.member.trim();
  if (input.requireExplicit) options.requireExplicit = true;
  if (input.forceLogin) options.forceLogin = true;
  return options;
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

  const input = parsed.data as Record<string, unknown>;

  switch (name) {
    case 'list_members':
      if (hasMultipleProfiles()) {
        return successResponse(name, { profiles: listProfileSummaries() });
      }
      return withAuthenticatedPage(name, {}, async (page, profile) => ({
        members: await getMembers(page, profile),
      }));

    case 'list_bookings': {
      const { profile, member } = input as { profile?: string; member?: string };
      return withAuthenticatedPage(
        name,
        authOptionsFromInput({ profile, member }),
        async (page) => ({
          bookings: await getBookings(page),
        })
      );
    }

    case 'list_favourites': {
      const { member, profile } = input as { member?: string; profile?: string };
      return withAuthenticatedPage(
        name,
        authOptionsFromInput({ profile, member }),
        async (page, activeProfile) => {
          let favourites = await getFavourites(page);
          const label = member?.trim() || activeProfile.name;
          if (label) {
            const q = label.toLowerCase();
            favourites = favourites.filter((f) => f.member?.toLowerCase().includes(q) ?? true);
          }
          return { favourites };
        }
      );
    }

    case 'check_availability': {
      const { activity, date, member, profile } = input as {
        activity: string;
        date: string;
        member?: string;
        profile?: string;
      };
      return withAuthenticatedPage(
        name,
        authOptionsFromInput({ profile, member }),
        (page, activeProfile) =>
          listAvailability(
            page,
            {
              activity,
              date,
              ...(member ? { memberName: member } : { memberName: activeProfile.name }),
            },
            activeProfile
          )
      );
    }

    case 'book_class': {
      const { activity, date, member, profile } = input as {
        activity: string;
        date: string;
        member?: string;
        profile?: string;
      };
      return withAuthenticatedPage(
        name,
        authOptionsFromInput({ profile, member, requireExplicit: !profile && !member }),
        async (page, activeProfile) => {
          let memberName = member?.trim() || activeProfile.name;
          if (!member?.trim() && !profile?.trim()) {
            if (hasMultipleProfiles()) {
              throw new EacliCommandError(
                'member or profile is required when multiple login profiles exist — call list_members first',
                'VALIDATION_ERROR'
              );
            }
            const members = await getMembers(page, activeProfile);
            if (members.length === 1) {
              memberName = members[0]!.name;
            } else if (members.length > 1) {
              throw new EacliCommandError(
                'member is required when multiple linked members exist — call list_members first',
                'VALIDATION_ERROR'
              );
            }
          }
          return bookClass(page, { memberName, activity, date }, activeProfile);
        }
      );
    }

    case 'cancel_booking': {
      const { activity, date, member, profile } = input as {
        activity: string;
        date: string;
        member?: string;
        profile?: string;
      };
      return withAuthenticatedPage(
        name,
        authOptionsFromInput({ profile, member }),
        (page, activeProfile) =>
          cancelBooking(
            page,
            {
              activity,
              date,
              ...(member ? { memberName: member } : { memberName: activeProfile.name }),
            },
            activeProfile
          )
      );
    }

    case 'login': {
      const { force, profile, member } = input as { force?: boolean; profile?: string; member?: string };
      try {
        const auth = await getAuthenticatedContext(
          authOptionsFromInput({ profile, member, forceLogin: Boolean(force) })
        );
        await closeAuthenticated(auth);
        return successResponse(name, { loggedIn: true, profile: auth.profile.key });
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