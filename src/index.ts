#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { closeAuthenticated, getAuthenticatedContext } from './auth.js';
import { bookClass, type BookClassResult } from './booking.js';
import { cancelBooking, type CancelBookingResult } from './cancelBooking.js';
import { getBookings, printBookings } from './bookings.js';
import { doctorCommand } from './doctor.js';
import { getFavourites, printFavourites } from './favourites.js';
import { listAvailability, printAvailability } from './availability.js';
import { getMembers, printMembers } from './members.js';
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

function printBookResult(result: BookClassResult): void {
  const action = result.waitlisted ? 'Waitlisted for' : 'Booked';
  if (result.confirmed) {
    console.log(chalk.green(`${action} ${result.activity} for ${result.member} (${result.sessionLabel}).`));
  } else {
    console.log(
      chalk.yellow(
        `Submitted ${result.waitlisted ? 'waitlist' : 'booking'} for ${result.member}: ${result.activity} (${result.sessionLabel}). Check the portal to confirm.`
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
  fn: (page: Awaited<ReturnType<typeof getAuthenticatedContext>>['page']) => Promise<T>,
  print?: (data: T) => void
): Promise<void> {
  if (debug) process.env.DEBUG = '1';
  let auth: Awaited<ReturnType<typeof getAuthenticatedContext>> | undefined;
  try {
    logInfo(chalk.blue('Connecting to Everyone Active...'));
    auth = await getAuthenticatedContext();
    logInfo(chalk.blue(status));
    const data = await fn(auth.page);
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
    'CLI to manage bookings at Everyone Active centres (uses Playwright). Session cookies are saved in .eacli-auth-state.json between runs.'
  )
  .version('1.3.0')
  .option('--json', 'Emit JSON on stdout (for LLM / automation)')
  .hook('preAction', () => {
    setJsonMode(Boolean(program.opts<{ json?: boolean }>().json));
  });

const bookingsCmd = program.command('bookings').description('Manage your bookings');

bookingsCmd
  .command('cancel')
  .description('Cancel a booking for a member on a given date')
  .option('--member <name>', 'Member name (partial match; default: currently selected)')
  .requiredOption('--activity <name>', 'Activity name (partial match, e.g. hiit)')
  .requiredOption('--date <date>', 'Date of the booking (e.g. saturday, 2026-05-24)')
  .option('--debug', 'Enable verbose debug logging')
  .action(async (options) => {
    await withAuth(
      'bookings.cancel',
      options.debug,
      `Cancelling ${options.activity} on ${options.date}...`,
      (page) =>
        cancelBooking(page, {
          ...(options.member ? { memberName: options.member } : {}),
          activity: options.activity,
          date: options.date,
        }),
      printCancelResult
    );
  });

program
  .command('book')
  .description('Book a Group Exercise class for a member on a given date')
  .requiredOption('--member <name>', 'Member name (partial match, e.g. Alex)')
  .requiredOption('--activity <name>', 'Activity name (partial match, e.g. hiit)')
  .requiredOption('--date <date>', 'Date to book (e.g. saturday, 2026-05-24, 24/05/2026)')
  .option('--debug', 'Enable verbose debug logging')
  .action(async (options) => {
    await withAuth(
      'book',
      options.debug,
      `Booking ${options.activity} for ${options.member} on ${options.date}...`,
      (page) =>
        bookClass(page, {
          memberName: options.member,
          activity: options.activity,
          date: options.date,
        }),
      printBookResult
    );
  });

program
  .command('login')
  .description('Force a fresh login (useful after password change)')
  .option('--debug', 'Enable verbose debug logging')
  .action(async (options) => {
    if (options.debug) process.env.DEBUG = '1';
    try {
      logInfo(chalk.blue('Forcing re-authentication...'));
      const auth = await getAuthenticatedContext({ forceLogin: true });
      await closeAuthenticated(auth);
      if (isJsonMode()) {
        writeJson(successResponse('login', { loggedIn: true }));
      } else {
        console.log(chalk.green('Login complete. Session saved.'));
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

const availabilityCmd = program.command('availability').description('See which sessions can be booked or waitlisted');

availabilityCmd
  .command('list')
  .description('List available and waitlist slots (defaults: selected member, all Group Exercise classes)')
  .option('--member <name>', 'Member name (partial match; default: currently selected)')
  .option('--activity <name>', 'Activity name (partial match; default: scan all Group Exercise classes)')
  .option('--date <date>', 'Only show this day (e.g. saturday, 2026-05-24)')
  .option('--debug', 'Enable verbose debug logging')
  .action(async (options) => {
    await withAuth(
      'availability.list',
      options.debug,
      'Fetching availability...',
      (page) =>
        listAvailability(page, {
          ...(options.member ? { memberName: options.member } : {}),
          ...(options.activity ? { activity: options.activity } : {}),
          ...(options.date ? { date: options.date } : {}),
        }),
      printAvailability
    );
  });

const favouritesCmd = program.command('favourites').description('Manage your QuickBook favourites');

favouritesCmd
  .command('book')
  .description('Book a class (alias for `eacli book`)')
  .requiredOption('--member <name>', 'Member name (partial match, e.g. Alex)')
  .requiredOption('--activity <name>', 'Activity name (partial match, e.g. hiit)')
  .requiredOption('--date <date>', 'Date to book (e.g. saturday, 2026-05-24, 24/05/2026)')
  .option('--debug', 'Enable verbose debug logging')
  .action(async (options) => {
    await withAuth(
      'favourites.book',
      options.debug,
      `Booking ${options.activity} for ${options.member} on ${options.date}...`,
      (page) =>
        bookClass(page, {
          memberName: options.member,
          activity: options.activity,
          date: options.date,
        }),
      printBookResult
    );
  });

favouritesCmd
  .command('list')
  .description('List your QuickBook favourites (classes/activities to book again)')
  .option('--debug', 'Enable verbose debug logging')
  .action(async (options) => {
    await withAuth(
      'favourites.list',
      options.debug,
      'Fetching favourites...',
      async (page) => {
        const favourites = await getFavourites(page);
        return { favourites };
      },
      (data) => printFavourites(data.favourites)
    );
  });

program
  .command('members')
  .description('List members who can be booked for')
  .option('--debug', 'Enable verbose debug logging')
  .action(async (options) => {
    await withAuth(
      'members',
      options.debug,
      'Fetching linked members...',
      async (page) => {
        const members = await getMembers(page);
        return { members };
      },
      (data) => printMembers(data.members)
    );
  });

bookingsCmd
  .command('list')
  .description('List your upcoming bookings')
  .option('--debug', 'Enable verbose debug logging and HTML dumps')
  .action(async (options) => {
    await withAuth(
      'bookings.list',
      options.debug,
      'Retrieving bookings...',
      async (page) => {
        const bookings = await getBookings(page);
        return { bookings };
      },
      (data) => printBookings(data.bookings)
    );
  });

program.parse(process.argv);
