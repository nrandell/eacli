import type { Page } from 'playwright';
import * as cheerio from 'cheerio';
import chalk from 'chalk';
import fs from 'fs';
import { ensureNoErrorPage } from './connect.js';
import { parseSessionDateLabel, resolveTargetDate, sameCalendarDay } from './favourites.js';
import { resolveMember } from './members.js';

export const MANAGE_BOOKINGS_URL =
  'https://book.everyoneactive.com/Connect/mrmViewMyBookings.aspx?showOption=1';

export interface ManageBookingRow {
  activity: string;
  date: string;
  time: string;
  site: string;
  member: string;
  cancelQaId: string;
}

export interface CancelBookingOptions {
  memberName?: string;
  activity: string;
  date: string;
}

export interface CancelBookingResult {
  member: string;
  activity: string;
  sessionLabel: string;
  confirmed: boolean;
}

function normalizeActivity(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '');
}

function matchesActivity(rowActivity: string, query: string): boolean {
  const q = normalizeActivity(query);
  const n = normalizeActivity(rowActivity);
  return n.includes(q) || q.includes(n);
}

function matchesMember(rowMember: string, memberName: string): boolean {
  const q = memberName.trim().toLowerCase();
  const n = rowMember.trim().toLowerCase();
  return n.includes(q) || q.includes(n);
}

function rowSessionDate(row: ManageBookingRow): Date | null {
  const timePart = row.time.match(/(\d{1,2}:\d{2})/)?.[1] ?? '';
  return parseSessionDateLabel(`${row.date}, ${timePart}`);
}

/** Parse rows from Manage Bookings (mrmViewMyBookings.aspx). */
export function parseManageBookings(html: string): ManageBookingRow[] {
  const $ = cheerio.load(html);
  const rows: ManageBookingRow[] = [];

  $('table[id*="gvBookings"] tbody tr.rowStyle, table[id*="gvBookings"] tbody tr.alternating').each((_, tr) => {
    const tds = $(tr).find('td');
    if (tds.length < 7) return;

    const cancelA = $(tr).find('a[data-qa-id*="lnkbutton-Cancel-"]');
    if (cancelA.length === 0) return;

    const qa = cancelA.attr('data-qa-id') ?? '';
    if (!qa) return;

    rows.push({
      activity: $(tds[0]).text().replace(/\s+/g, ' ').trim(),
      date: $(tds[1]).text().replace(/\s+/g, ' ').trim(),
      time: $(tds[2]).text().replace(/\s+/g, ' ').trim(),
      site: $(tds[3]).text().replace(/\s+/g, ' ').trim(),
      member: $(tds[5]).text().replace(/\s+/g, ' ').trim(),
      cancelQaId: qa,
    });
  });

  return rows;
}

function cancelIdFromQa(qa: string): string | undefined {
  return qa.match(/Cancel-ID(\S+)/)?.[1];
}

function findMatchingRow(rows: ManageBookingRow[], options: CancelBookingOptions): ManageBookingRow {
  const targetDate = resolveTargetDate(options.date);
  let candidates = rows.filter((row) => {
    const sessionDate = rowSessionDate(row);
    if (!sessionDate || !sameCalendarDay(sessionDate, targetDate)) return false;
    if (!matchesActivity(row.activity, options.activity)) return false;
    if (options.memberName?.trim() && !matchesMember(row.member, options.memberName)) return false;
    return true;
  });

  if (options.memberName?.trim() && candidates.length === 0) {
    candidates = rows.filter((row) => {
      const sessionDate = rowSessionDate(row);
      return (
        sessionDate &&
        sameCalendarDay(sessionDate, targetDate) &&
        matchesActivity(row.activity, options.activity)
      );
    });
  }

  if (candidates.length === 0) {
    const available = rows
      .filter((r) => matchesActivity(r.activity, options.activity))
      .map((r) => `${r.activity} — ${r.date} ${r.time} (${r.member})`);
    throw new Error(
      `No booking found for "${options.activity}" on ${options.date}.` +
        (available.length > 0 ? ` Matching activity: ${available.join('; ')}` : '')
    );
  }

  if (candidates.length > 1) {
    const list = candidates.map((r) => `${r.date} ${r.time} (${r.member})`).join('; ');
    throw new Error(
      `Multiple bookings match "${options.activity}" on ${options.date}: ${list}. Use --member to disambiguate.`
    );
  }

  return candidates[0]!;
}

/** Cancel a booking via Manage Bookings. */
export async function cancelBooking(page: Page, options: CancelBookingOptions): Promise<CancelBookingResult> {
  const member = await resolveMember(page, options.memberName);
  const memberLabel = member?.name ?? options.memberName ?? 'account holder';

  await page.goto(MANAGE_BOOKINGS_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await ensureNoErrorPage(page, 'manage-bookings');

  const rows = parseManageBookings(await page.content());
  if (rows.length === 0) {
    throw new Error('No cancellable bookings found on Manage Bookings page.');
  }

  const row = findMatchingRow(rows, {
    ...options,
    ...(member?.name ? { memberName: member.name } : {}),
  });

  const cancelId = cancelIdFromQa(row.cancelQaId);
  if (!cancelId) {
    throw new Error(`Could not find cancel action for ${row.activity} on ${row.date}.`);
  }

  const sessionLabel = `${row.date}, ${row.time.match(/(\d{1,2}:\d{2})/)?.[1] ?? row.time}`;

  if (process.env.DEBUG) {
    console.log(chalk.gray(`[debug] Cancelling: ${row.activity} — ${sessionLabel} (${row.member})`));
    console.log(chalk.gray(`[debug] Cancel ID: ${cancelId}`));
  }

  const targetDmY = (() => {
    const d = rowSessionDate(row)!;
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${d.getFullYear()}`;
  })();

  const cancelLink = page
    .locator(`a[data-qa-id*="lnkbutton-Cancel-ID${cancelId}"][data-qa-id*="Date&Time=${targetDmY}"]`)
    .first();

  await cancelLink.click();
  await page.waitForURL(/mrmConfirmMove\.aspx/i, { timeout: 30000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await ensureNoErrorPage(page, 'cancel-confirm');

  const confirmBtn = page.locator('#ctl00_MainContent_btnConfirm, input[value="Confirm"]').first();
  await confirmBtn.click();
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1000);

  const bodyText = (await page.textContent('body')) ?? '';
  const confirmed =
    /cancelled|cancellation complete|successfully cancelled|booking has been cancelled/i.test(bodyText) ||
    /mrmViewMyBookings|memberHomePage/i.test(page.url());

  if (process.env.DEBUG) {
    console.log(chalk.gray(`[debug] Final URL: ${page.url()}`));
    fs.mkdirSync('.eacli-session', { recursive: true });
    fs.writeFileSync('.eacli-session/last-cancel-result.html', await page.content());
  }

  return {
    member: row.member || memberLabel,
    activity: row.activity,
    sessionLabel,
    confirmed,
  };
}
