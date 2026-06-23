#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { closeAuthenticated, getAuthenticatedContext, type AuthOptions } from './auth.js';
import { bookClass, type BookClassResult } from './booking.js';
import { cancelBooking, type CancelBookingResult } from './cancelBooking.js';
import { getBookings, printBookings } from './bookings.js';
import { doctorCommand } from './doctor.js';
import { getFavourites, printFavourites } from './favourites.js';
import { listAvailability, printAvailability } from './availability.js';
import { getMembers, printMembers, printProfileSummaries } from './members.js';
import {
  errorResponse,
  exitCodeForError,
  isJsonMode,
  logInfo,
  mapErrorFromThrowable,
  setJsonMode,
  successResponse,
  writeJson,
} from './output.js';
import { hasMultipleProfiles, listProfileSummaries } from './profiles.js';

interface GlobalOptions {
  json?: boolean;
  profile?: string;
}

function globalOpts(): GlobalOptions {
  return program.opts<GlobalOptions>();
}

function authOpts(extra: AuthOptions = {}): AuthOptions {
  const profile = extra.profile ?? globalOpts().profile;
  return {
    ...extra,
    ...(profile ? { profile } : {}),
  };
}

function printBookResult(result: BookClassResult): void {
  const action = result.waitlisted ? 'Waitlisted for' : 'Booked';
  if (result.confirmed) {
    console.log(chalk.green(`${action} ${result.activity} for ${result.member} (${result.sessionLabel}).`));
  } else {
    const extra = result.confirmationDetails ? ` (${result.confirmationDetails})` : '';
    console.log(
      chalk.yellow(
        `Submitted ${result.waitlisted ? 'waitlist' : 'booking'} for ${result.member}: ${result.activity} (${result.sessionLabel}). Check the portal to confirm.${extra}`
      )
    );
  }
}

function printCancelResult(result: CancelBookingResult): void {
  if (result.confirmed) {
    console.log(chalk.green(`Cancelled ${result.activity} for ${result.member} (${result.sessionLabel}).`));
  } else {
    console.log(
      chalk.yellow(
        `Submitted cancellation for ${result.member}: ${result.activity} (${result.sessionLabel}). Check the portal to confirm.`
      )
    );
  }
}

async function withAuth<T>(
  command: string,
  debug: boolean | undefined,
  status: string,
  authOptions: AuthOptions,
  fn: (
    page: Awaited<ReturnType<typeof getAuthenticatedContext>>['page'],
    profile: Awaited<ReturnType<typeof getAuthenticatedContext>>['profile']
  ) => Promise<T>,
  print?: (data: T) => void
): Promise<void> {
  if (debug) process.env.DEBUG = '1';
  let auth: Awaited<ReturnType<typeof getAuthenticatedContext>> | undefined;
  try {
    logInfo(chalk.blue('Connecting to Everyone Active...'));
    auth = await getAuthenticatedContext(authOpts(authOptions));
    logInfo(chalk.blue(status));
    const data = await fn(auth.page, auth.profile);
    if (isJsonMode()) {
      writeJson(successResponse(command, data));
    } else if (print) {
      print(data);
    }
  } catch (err: unknown) {
    const error = mapErrorFromThrowable(err);
    if (isJsonMode()) {
      writeJson(errorResponse(command, error));
    } else {
      console.error(chalk.red('Error:'), error.message);
    }
    process.exit(exitCodeForError(error.code));
  } finally {
    if (auth) await closeAuthenticated(auth).catch(() => {});
  }
}

const program = new Command();

program
  .name('eacli')
  .description(
    'CLI to manage bookings at Everyone Active centres (uses Playwright). Sessions are saved per profile in .eacli-session/.'
  )
  .version('1.5.0')
  .option('--json', 'Emit JSON on stdout (for LLM / automation)')
  .option('--profile <key>', 'Login profile key (separate EA account; see .eacli-profiles.json)')
  .hook('preAction', () => {
    setJsonMode(Boolean(program.opts<GlobalOptions>().json));
  });

const bookingsCmd = program.command('bookings').description('Manage your bookings');

bookingsCmd
  .command('cancel')
  .description('Cancel a booking for a member on a given date')
  .option('--member <name>', 'Member / profile name (partial match; default: active profile)')
  .requiredOption('--activity <name>', 'Activity name (partial match, e.g. hiit)')
  .requiredOption('--date <date>', 'Date of the booking (e.g. saturday, 2026-05-24)')
  .option('--debug', 'Enable verbose debug logging')
  .action(async (options) => {
    await withAuth(
      'bookings.cancel',
      options.debug,
      `Cancelling ${options.activity} on ${options.date}...`,
      { member: options.member },
      (page, profile) =>
        cancelBooking(
          page,
          {
            ...(options.member ? { memberName: options.member } : { memberName: profile.name }),
            activity: options.activity,
            date: options.date,
          },
          profile
        ),
      printCancelResult
    );
  });

program
  .command('book')
  .description('Book a Group Exercise class for a member on a given date')
  .requiredOption('--member <name>', 'Member / profile name (partial match, e.g. hayley)')
  .requiredOption('--activity <name>', 'Activity name (partial match, e.g. hiit)')
  .requiredOption('--date <date>', 'Date to book (e.g. saturday, 2026-05-24, 24/05/2026)')
  .option('--debug', 'Enable verbose debug logging')
  .action(async (options) => {
    await withAuth(
      'book',
      options.debug,
      `Booking ${options.activity} for ${options.member} on ${options.date}...`,
      { member: options.member },
      (page, profile) =>
        bookClass(
          page,
          {
            memberName: options.member,
            activity: options.activity,
            date: options.date,
          },
          profile
        ),
      printBookResult
    );
  });

program
  .command('login')
  .description('Force a fresh login (useful after password change)')
  .option('--profile <key>', 'Profile to log in (default profile if omitted)')
  .option('--member <name>', 'Resolve profile from member name')
  .option('--debug', 'Enable verbose debug logging')
  .action(async (options) => {
    if (options.debug) process.env.DEBUG = '1';
    try {
      logInfo(chalk.blue('Forcing re-authentication...'));
      const auth = await getAuthenticatedContext(
        authOpts({
          forceLogin: true,
          profile: options.profile,
          member: options.member,
        })
      );
      await closeAuthenticated(auth);
      if (isJsonMode()) {
        writeJson(successResponse('login', { loggedIn: true, profile: auth.profile.key }));
      } else {
        console.log(chalk.green(`Login complete for profile "${auth.profile.key}". Session saved.`));
      }
    } catch (err: unknown) {
      const error = mapErrorFromThrowable(err);
      if (isJsonMode()) {
        writeJson(errorResponse('login', error));
      } else {
        console.error(chalk.red('Login error:'), error.message);
      }
      process.exit(exitCodeForError(error.code));
    }
  });

program
  .command('doctor')
  .description('Check local setup (.env, session, Playwright)')
  .action(async () => {
    await doctorCommand();
  });

const profilesCmd = program.command('profiles').description('Manage separate Everyone Active login profiles');

profilesCmd
  .command('list')
  .description('List configured profiles and saved session status')
  .action(() => {
    const profiles = listProfileSummaries();
    if (isJsonMode()) {
      writeJson(successResponse('profiles.list', { profiles }));
    } else {
      printProfileSummaries(profiles);
    }
  });

const availabilityCmd = program.command('availability').description('See which sessions can be booked or waitlisted');

availabilityCmd
  .command('list')
  .description('List available and waitlist slots (defaults: selected member, all Group Exercise classes)')
  .option('--member <name>', 'Member / profile name (partial match; default: active profile)')
  .option('--activity <name>', 'Activity name (partial match; default: scan all Group Exercise classes)')
  .option('--date <date>', 'Only show this day (e.g. saturday, 2026-05-24)')
  .option('--debug', 'Enable verbose debug logging')
  .action(async (options) => {
    await withAuth(
      'availability.list',
      options.debug,
      'Fetching availability...',
      { member: options.member },
      (page, profile) =>
        listAvailability(
          page,
          {
            ...(options.member ? { memberName: options.member } : { memberName: profile.name }),
            ...(options.activity ? { activity: options.activity } : {}),
            ...(options.date ? { date: options.date } : {}),
          },
          profile
        ),
      printAvailability
    );
  });

const favouritesCmd = program.command('favourites').description('Manage your QuickBook favourites');

favouritesCmd
  .command('book')
  .description('Book a class (alias for `eacli book`)')
  .requiredOption('--member <name>', 'Member / profile name (partial match)')
  .requiredOption('--activity <name>', 'Activity name (partial match, e.g. hiit)')
  .requiredOption('--date <date>', 'Date to book (e.g. saturday, 2026-05-24, 24/05/2026)')
  .option('--debug', 'Enable verbose debug logging')
  .action(async (options) => {
    await withAuth(
      'favourites.book',
      options.debug,
      `Booking ${options.activity} for ${options.member} on ${options.date}...`,
      { member: options.member },
      (page, profile) =>
        bookClass(
          page,
          {
            memberName: options.member,
            activity: options.activity,
            date: options.date,
          },
          profile
        ),
      printBookResult
    );
  });

favouritesCmd
  .command('list')
  .description('List your QuickBook favourites (classes/activities to book again)')
  .option('--member <name>', 'Filter by member / profile name')
  .option('--debug', 'Enable verbose debug logging')
  .action(async (options) => {
    await withAuth(
      'favourites.list',
      options.debug,
      'Fetching favourites...',
      { member: options.member },
      async (page) => {
        const favourites = await getFavourites(page);
        return { favourites };
      },
      (data) => printFavourites(data.favourites)
    );
  });

program
  .command('members')
  .description('List bookable members (configured profiles or portal linked members)')
  .option('--debug', 'Enable verbose debug logging')
  .action(async (options) => {
    if (hasMultipleProfiles()) {
      const profiles = listProfileSummaries();
      if (isJsonMode()) {
        writeJson(successResponse('members', { profiles }));
      } else {
        printProfileSummaries(profiles);
      }
      return;
    }

    await withAuth(
      'members',
      options.debug,
      'Fetching linked members...',
      {},
      async (page, profile) => {
        const members = await getMembers(page, profile);
        return { members };
      },
      (data) => printMembers(data.members)
    );
  });

bookingsCmd
  .command('list')
  .description('List upcoming bookings for the active profile')
  .option('--member <name>', 'Select profile by member name')
  .option('--debug', 'Enable verbose debug logging and HTML dumps')
  .action(async (options) => {
    await withAuth(
      'bookings.list',
      options.debug,
      'Retrieving bookings...',
      { member: options.member },
      async (page) => {
        const bookings = await getBookings(page);
        return { bookings };
      },
      (data) => printBookings(data.bookings)
    );
  });

program.parse(process.argv);