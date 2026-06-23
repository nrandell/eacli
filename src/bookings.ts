import type { Page } from 'playwright';
import { printTable } from 'console-table-printer';
import chalk from 'chalk';
import fs from 'fs';
import * as cheerio from 'cheerio';
import { MEMBER_HOME_URL, ensureNoErrorPage } from './connect.js';
import { parseSessionDateLabel } from './favourites.js';
import { getMembers, switchMember } from './members.js';
import { hasMultipleProfiles } from './profiles.js';
import {
  MANAGE_BOOKINGS_URL,
  collectManageBookingRows,
  parseManageBookings,
  type ManageBookingRow,
} from './cancelBooking.js';

export { MEMBER_HOME_URL } from './connect.js';

export interface Booking {
  date: string;
  time: string;
  activity: string;
  location: string;
  status: string;
  reference?: string;
  /** Who is booked on this session (canonical). Always use this array. */
  members: string[];
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

export function normalizeBookingActivity(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '');
}

export function bookingSessionKey(date: string, time: string, activity: string): string {
  const timePart = time.match(/(\d{1,2}:\d{2})/)?.[1] ?? time.trim();
  return `${date.trim()}|${timePart}|${normalizeBookingActivity(activity)}`;
}

export function referenceFromCancelQa(qa: string): string | undefined {
  return qa.match(/Cancel-ID(\S+)/)?.[1];
}

function bookingToDate(date: string, time: string): Date {
  const timePart = time.match(/(\d{1,2}:\d{2})/)?.[1] ?? time.trim();
  const labeled = parseSessionDateLabel(`${date}, ${timePart}`);
  if (labeled) {
    const [h = '0', m = '0'] = timePart.split(':');
    return new Date(
      labeled.getFullYear(),
      labeled.getMonth(),
      labeled.getDate(),
      parseInt(h, 10),
      parseInt(m, 10)
    );
  }
  const parts = date.trim().split(/\s+/);
  const day = parseInt(parts[1] ?? '1', 10);
  const monthStr = (parts[2] ?? parts[1] ?? 'jan').slice(0, 3).toLowerCase();
  const month = MONTHS[monthStr] ?? 0;
  const [h = '0', min = '0'] = timePart.split(':');
  const now = new Date();
  let year = now.getFullYear();
  if (month < now.getMonth() || (month === now.getMonth() && day < now.getDate())) year++;
  return new Date(year, month, day, parseInt(h, 10), parseInt(min, 10));
}

function sortBookings(bookings: Booking[]): Booking[] {
  return [...bookings].sort(
    (a, b) => bookingToDate(a.date, a.time).getTime() - bookingToDate(b.date, b.time).getTime()
  );
}

/** Map one Manage Bookings row to a partial booking (single member). */
export function manageRowToBooking(row: ManageBookingRow): Booking {
  const timePart = row.time.match(/(\d{1,2}:\d{2})/)?.[1] ?? row.time.trim();
  const reference = referenceFromCancelQa(row.cancelQaId);
  const booking: Booking = {
    date: row.date,
    time: timePart,
    activity: row.activity,
    location: row.site || 'Centre',
    status: row.status || 'Confirmed',
    members: row.member.trim() ? [row.member.trim()] : [],
  };
  if (reference) booking.reference = reference;
  return booking;
}

/** Group Manage Bookings rows by session; merge members who share the same class. */
export function groupBookingsBySession(rows: ManageBookingRow[]): Booking[] {
  const bySession = new Map<string, Booking>();

  for (const row of rows) {
    const partial = manageRowToBooking(row);
    const key = bookingSessionKey(partial.date, partial.time, partial.activity);
    const memberName = row.member.trim();
    const existing = bySession.get(key);

    if (existing) {
      if (memberName && !existing.members.includes(memberName)) {
        existing.members.push(memberName);
      }
      if (!existing.reference && partial.reference) {
        existing.reference = partial.reference;
      }
      if (partial.status && existing.status !== partial.status) {
        existing.status = partial.status;
      }
    } else {
      bySession.set(key, { ...partial });
    }
  }

  const grouped = [...bySession.values()];
  for (const b of grouped) {
    b.members.sort((a, c) => a.localeCompare(c));
  }
  return sortBookings(grouped);
}

/** Parse upcoming bookings from the member home #upcomingPanel (fallback only). */
export function parseUpcomingBookings(html: string): Booking[] {
  const $ = cheerio.load(html);
  const panel = $('#upcomingPanel');
  const bookings: Booking[] = [];

  panel.find('a[href*="bookinginformation"], a[data-qa-id*="upcomingBookings"]').each((_, el) => {
    const supText = $(el).find('sup').text().trim();
    const commaSplit = supText.split(',');
    const date = commaSplit[0]?.trim() ?? '';
    const time = commaSplit[1]?.trim() ?? '';
    const activity = $(el).attr('title') ?? $(el).clone().children().remove().end().text().trim();
    const href = $(el).attr('href') ?? '';
    const idMatch = href.match(/id=(\d+)/);
    if (activity) {
      const booking: Booking = {
        date,
        time,
        activity,
        location: 'Centre',
        status: 'Confirmed',
        members: [],
      };
      if (idMatch?.[1]) booking.reference = idMatch[1];
      bookings.push(booking);
    }
  });

  if (bookings.length > 0) return bookings;

  panel.find('table tr').each((_, tr) => {
    const cells = $(tr).find('td, th').map((__, td) => $(td).text().trim()).get().filter(Boolean);
    if (cells.length >= 2 && !/date|time|activity|booking/i.test(cells[0] ?? '')) {
      const [date = '', time = '', activity = '', location = '', status = '', reference = ''] = cells;
      if (date && (activity || time)) {
        const booking: Booking = { date, time, activity, location, status, members: [] };
        if (reference) booking.reference = reference;
        bookings.push(booking);
      }
    }
  });

  return bookings;
}

async function getBookingsFromUpcomingPanel(page: Page): Promise<Booking[]> {
  await page.goto(MEMBER_HOME_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await ensureNoErrorPage(page, 'member-home');

  const bookings = parseUpcomingBookings(await page.content());
  if (process.env.DEBUG) {
    console.log(
      chalk.yellow(
        `[debug] Manage Bookings empty; fallback upcoming panel: ${bookings.length} booking(s) (no per-member attribution)`
      )
    );
    try {
      fs.mkdirSync('.eacli-session', { recursive: true });
      fs.writeFileSync('.eacli-session/last-bookings-page.html', await page.content());
    } catch {}
  }
  return sortBookings(bookings);
}

export async function getBookings(page: Page): Promise<Booking[]> {
  // Discover linked members first (this also ensures we are on the member home).
  // For accounts with >1 linked member we explicitly switch context to *each* one
  // and collect the full (paged) Manage Bookings grid while that member is active.
  // This guarantees correct attribution even when the portal only surfaces the
  // "current" member's rows in a given context (the root cause of "only showed mine").
  const linkedMembers = await getMembers(page);

  const allRows: ManageBookingRow[] = [];
  const seen = new Set<string>();

  const addRows = (rows: ManageBookingRow[]) => {
    for (const r of rows) {
      // Must always include member in the uniqueness key.
      // Recurring bookings frequently share the same cancelQaId (the ActivityID) across household members.
      // Using cancelQaId alone (via ||) would drop the second person's row.
      const key = `${r.date}|${r.time}|${normalizeBookingActivity(r.activity)}|${r.member}|${r.cancelQaId || ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        allRows.push(r);
      }
    }
  };

  if (hasMultipleProfiles() || linkedMembers.length <= 1) {
    if (process.env.DEBUG) {
      console.log(chalk.gray(`[debug] ${linkedMembers.length === 0 ? 'No linked members' : 'Single linked member'} — collecting from current context only`));
    }
    const rows = await collectManageBookingRows(page);
    addRows(rows);

    if (process.env.DEBUG) {
      try {
        fs.mkdirSync('.eacli-session', { recursive: true });
        fs.writeFileSync('.eacli-session/last-manage-bookings.html', await page.content());
        console.log(chalk.gray(`[debug] Saved Manage Bookings HTML → .eacli-session/last-manage-bookings.html`));
      } catch {}
    }
  } else {
    if (process.env.DEBUG) {
      console.log(
        chalk.gray(`[debug] ${linkedMembers.length} linked members — collecting Manage Bookings rows while switched to each member for complete household attribution`)
      );
    }

    for (const member of linkedMembers) {
      try {
        if (process.env.DEBUG) {
          console.log(chalk.gray(`[debug] → switching to ${member.name} ...`));
        }
        await switchMember(page, member);

        // Capture the member home page in this context (upcoming panel often reflects the current member)
        if (process.env.DEBUG) {
          try {
            await page.goto(MEMBER_HOME_URL, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
            await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
            const homeHtml = await page.content();

            fs.mkdirSync('.eacli-session', { recursive: true });
            const safeName = member.name.replace(/[^a-z0-9]/gi, '_');
            const homePath = `.eacli-session/last-home-${safeName}.html`;
            fs.writeFileSync(homePath, homeHtml);
            console.log(chalk.gray(`[debug]   Saved member home HTML for ${member.name} → ${homePath} (check upcoming panel)`));

            // Diagnostic: parse what upcoming bookings are visible in *this* member's context
            const upcoming = parseUpcomingBookings(homeHtml);
            const upcomingSummary = upcoming.length > 0
              ? upcoming.map(b => `${b.date} ${b.time} ${b.activity}`).join(' | ')
              : '(none)';
            console.log(chalk.gray(`[debug]   Upcoming panel for ${member.name} (${upcoming.length} items): ${upcomingSummary}`));
          } catch (e) {
            if (process.env.DEBUG) console.log(chalk.gray(`[debug]   Failed to capture/parse home for ${member.name}: ${e}`));
          }
        }

        const rows = await collectManageBookingRows(page);
        addRows(rows);

        // Always save the HTML for this specific member context when debugging.
        if (process.env.DEBUG) {
          try {
            fs.mkdirSync('.eacli-session', { recursive: true });
            const safeName = member.name.replace(/[^a-z0-9]/gi, '_');
            const path = `.eacli-session/last-manage-bookings-${safeName}.html`;
            fs.writeFileSync(path, await page.content());
            console.log(chalk.gray(`[debug]   Saved context HTML for ${member.name} → ${path}`));
          } catch {}
        }
      } catch (err: unknown) {
        if (process.env.DEBUG) {
          console.log(chalk.yellow(`[debug]   Failed while collecting as ${member.name}: ${err instanceof Error ? err.message : err}`));
        }
        // Best-effort: continue with remaining members
      }
    }

    if (process.env.DEBUG) {
      const rawMembers = [...new Set(allRows.map(r => r.member))].filter(Boolean);
      console.log(chalk.gray(`[debug] Raw 'member' values extracted from grid across all contexts: ${rawMembers.join(' | ') || '(none)'}`));
      console.log(chalk.gray(`[debug] (If you only see one name here, the Manage Bookings grid itself is not varying by member context on this account.)`));
    }
  }

  let bookings = groupBookingsBySession(allRows);

  if (process.env.DEBUG) {
    console.log(chalk.gray(`[debug] Page URL: ${page.url()}`));
    console.log(
      chalk.gray(
        `[debug] Manage Bookings (multi-context, paged): ${allRows.length} row(s) → ${bookings.length} session(s)`
      )
    );
  }

  if (bookings.length === 0 && allRows.length === 0) {
    try {
      fs.mkdirSync('.eacli-session', { recursive: true });
      fs.writeFileSync('.eacli-session/last-manage-bookings.html', await page.content());
      if (process.env.DEBUG) {
        console.log(chalk.gray('[debug] Saved HTML to .eacli-session/last-manage-bookings.html (fallback path)'));
      }
    } catch {}
    bookings = await getBookingsFromUpcomingPanel(page);
  } else if (process.env.DEBUG) {
    // In DEBUG, always leave a copy of the final Manage Bookings page for inspection
    try {
      fs.mkdirSync('.eacli-session', { recursive: true });
      fs.writeFileSync('.eacli-session/last-manage-bookings.html', await page.content());
    } catch {}
  }

  return bookings;
}

function formatMembersColumn(booking: Booking): string {
  if (booking.members.length === 0) return '—';
  return booking.members.join('; ');
}

export function printBookings(bookings: Booking[]): void {
  if (bookings.length === 0) {
    console.log(chalk.yellow('No upcoming bookings found.'));
    return;
  }

  console.log(chalk.green(`\nYou have ${bookings.length} booking(s):\n`));

  const showMembers = bookings.some((b) => b.members.length > 0);
  const tableData = bookings.map((b, idx) => ({
    '#': idx + 1,
    ...(showMembers ? { Members: formatMembersColumn(b) } : {}),
    Date: b.date,
    Time: b.time,
    Activity: b.activity,
    Location: b.location,
    Status: b.status,
    Ref: b.reference || '-',
  }));

  printTable(tableData);
}
