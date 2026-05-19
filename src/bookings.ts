import type { Page } from 'playwright';
import { printTable } from 'console-table-printer';
import chalk from 'chalk';
import fs from 'fs';
import * as cheerio from 'cheerio';
import { parseLinkedMembers, switchMember } from './members.js';
import type { LinkedMember } from './members.js';
import { MEMBER_HOME_URL, ensureNoErrorPage } from './connect.js';

export { MEMBER_HOME_URL } from './connect.js';

export interface Booking {
  date: string;
  time: string;
  activity: string;
  location: string;
  status: string;
  reference?: string;
  member?: string;
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function bookingToDate(date: string, time: string): Date {
  const parts = date.trim().split(/\s+/);
  const day = parseInt(parts[1] ?? '1', 10);
  const monthStr = (parts[2] ?? 'jan').slice(0, 3).toLowerCase();
  const month = MONTHS[monthStr] ?? 0;
  const [h = '0', m = '0'] = time.split(':');
  const now = new Date();
  let year = now.getFullYear();
  if (month < now.getMonth() || (month === now.getMonth() && day < now.getDate())) year++;
  return new Date(year, month, day, parseInt(h, 10), parseInt(m, 10));
}

/** Parse upcoming bookings from the member home #upcomingPanel (Connect portal). */
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
      const booking: Booking = { date, time, activity, location: 'Centre', status: 'Confirmed' };
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
        bookings.push({ date, time, activity, location, status, reference });
      }
    }
  });

  return bookings;
}

function dedupeBookings(bookings: Booking[]): Booking[] {
  const seen = new Map<string, Booking>();
  for (const booking of bookings) {
    const key = booking.reference ?? `${booking.date}|${booking.time}|${booking.activity}`;
    const existing = seen.get(key);
    if (existing) {
      if (booking.member && existing.member && !existing.member.includes(booking.member)) {
        existing.member = `${existing.member}, ${booking.member}`;
      }
    } else {
      seen.set(key, { ...booking });
    }
  }
  const deduped = [...seen.values()];
  deduped.sort((a, b) => bookingToDate(a.date, a.time).getTime() - bookingToDate(b.date, b.time).getTime());
  return deduped;
}

async function collectBookingsForMember(page: Page, member?: LinkedMember): Promise<Booking[]> {
  const html = await page.content();
  return parseUpcomingBookings(html).map((b) => {
    if (!member) return b;
    return { ...b, member: member.name };
  });
}

export async function getBookings(page: Page): Promise<Booking[]> {
  await page.goto(MEMBER_HOME_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await ensureNoErrorPage(page, 'member-home');

  const panelVisible = await page.locator('#upcomingPanel').isVisible().catch(() => false);
  if (!panelVisible && process.env.DEBUG) {
    console.log(chalk.yellow('[debug] #upcomingPanel not visible; saving page HTML for inspection'));
    try {
      fs.mkdirSync('.eacli-session', { recursive: true });
      fs.writeFileSync('.eacli-session/last-member-home.html', await page.content());
    } catch {}
  }

  const members = parseLinkedMembers(await page.content());
  let allBookings: Booking[] = [];

  if (members.length <= 1) {
    allBookings = await collectBookingsForMember(page);
  } else {
    if (process.env.DEBUG) {
      console.log(chalk.gray(`[debug] Members: ${members.map((m) => m.name).join(', ')}`));
    }
    const selectedFirst = members.find((m) => m.selected) ?? members[0]!;
    const rest = members.filter((m) => m.id !== selectedFirst.id);

    allBookings.push(...(await collectBookingsForMember(page, selectedFirst)));

    for (const member of rest) {
      await switchMember(page, member);
      const memberBookings = await collectBookingsForMember(page, member);
      if (process.env.DEBUG) {
        console.log(chalk.gray(`[debug] ${member.name}: ${memberBookings.length} booking(s)`));
      }
      allBookings.push(...memberBookings);
    }

    allBookings = dedupeBookings(allBookings);
  }

  if (process.env.DEBUG) {
    console.log(chalk.gray(`[debug] Page URL: ${page.url()}`));
    console.log(chalk.gray(`[debug] Extracted ${allBookings.length} booking(s) from member home`));
  }

  if (allBookings.length === 0) {
    const bodyText = (await page.textContent('body'))?.slice(0, 500) || '';
    if (process.env.DEBUG) console.log(chalk.yellow('[debug] Page body sample:'), bodyText);
    try {
      fs.mkdirSync('.eacli-session', { recursive: true });
      fs.writeFileSync('.eacli-session/last-bookings-page.html', await page.content());
      console.log(chalk.gray('[debug] Saved full HTML to .eacli-session/last-bookings-page.html'));
    } catch {}
  }

  return allBookings;
}

export function printBookings(bookings: Booking[]): void {
  if (bookings.length === 0) {
    console.log(chalk.yellow('No upcoming bookings found.'));
    return;
  }

  console.log(chalk.green(`\nYou have ${bookings.length} booking(s):\n`));

  const showMember = bookings.some((b) => b.member !== undefined);
  const tableData = bookings.map((b, idx) => ({
    '#': idx + 1,
    ...(showMember ? { Member: b.member ?? '' } : {}),
    Date: b.date,
    Time: b.time,
    Activity: b.activity,
    Location: b.location,
    Status: b.status,
    Ref: b.reference || '-',
  }));

  printTable(tableData);
}
