import type { Page } from 'playwright';
import { printTable } from 'console-table-printer';
import chalk from 'chalk';
import fs from 'fs';
import * as cheerio from 'cheerio';
import { MEMBER_HOME_URL, ensureNoErrorPage } from './connect.js';
import { parseSessionDateLabel } from './favourites.js';
import {
  MANAGE_BOOKINGS_URL,
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
  /** Who is booked on this session (canonical). */
  members: string[];
  /** Set when exactly one member is booked (backward compatibility for agents). */
  member?: string;
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

function applyMemberCompat(booking: Booking): Booking {
  const base = {
    date: booking.date,
    time: booking.time,
    activity: booking.activity,
    location: booking.location,
    status: booking.status,
    members: booking.members,
    ...(booking.reference !== undefined ? { reference: booking.reference } : {}),
  };
  if (booking.members.length === 1) {
    return { ...base, member: booking.members[0]! };
  }
  return base;
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
    status: 'Confirmed',
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
    } else {
      bySession.set(key, { ...partial });
    }
  }

  const grouped = [...bySession.values()];
  for (const b of grouped) {
    b.members.sort((a, c) => a.localeCompare(c));
  }
  return sortBookings(grouped.map(applyMemberCompat));
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
  await page.goto(MANAGE_BOOKINGS_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await ensureNoErrorPage(page, 'manage-bookings');

  const html = await page.content();
  const rows = parseManageBookings(html);
  let bookings = groupBookingsBySession(rows);

  if (process.env.DEBUG) {
    console.log(chalk.gray(`[debug] Page URL: ${page.url()}`));
    console.log(
      chalk.gray(
        `[debug] Manage Bookings: ${rows.length} row(s) → ${bookings.length} session(s)`
      )
    );
  }

  if (bookings.length === 0) {
    if (rows.length === 0) {
      try {
        fs.mkdirSync('.eacli-session', { recursive: true });
        fs.writeFileSync('.eacli-session/last-manage-bookings.html', html);
        if (process.env.DEBUG) {
          console.log(chalk.gray('[debug] Saved HTML to .eacli-session/last-manage-bookings.html'));
        }
      } catch {}
    }
    bookings = await getBookingsFromUpcomingPanel(page);
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
