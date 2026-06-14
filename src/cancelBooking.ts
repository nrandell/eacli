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
  status: string;
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

function statusFromCaption(caption: string): string | undefined {
  const text = caption.replace(/\s+/g, ' ').trim();
  if (/waiting\s*list/i.test(text)) return 'Waiting List';
  if (/confirmed/i.test(text)) return 'Confirmed';
  return undefined;
}

function statusFromCancelQa(qa: string): string | undefined {
  const match = qa.match(/Status=(\w+)/i);
  if (!match?.[1]) return undefined;
  const raw = match[1];
  if (/waitinglist/i.test(raw)) return 'Waiting List';
  if (/confirmed/i.test(raw)) return 'Confirmed';
  return raw;
}

function inferSectionStatus($table: cheerio.Cheerio<any>, cancelQa: string): string {
  const caption = $table.find('caption').text();
  return statusFromCaption(caption) ?? statusFromCancelQa(cancelQa) ?? 'Confirmed';
}

function parseManageBookingsTable(
  $: cheerio.CheerioAPI,
  table: any,
  tableIdx: number,
  rows: ManageBookingRow[]
): void {
  const $table = $(table);
  const candidateRows = $table.find('tbody tr, tr');

  if (process.env.DEBUG) {
    const tableId = $table.attr('id') ?? `(table ${tableIdx})`;
    console.log(
      chalk.gray(
        `[debug] parseManageBookings: table ${tableIdx + 1} (${tableId}): ${candidateRows.length} candidate <tr>`
      )
    );
  }

  candidateRows.each((idx, tr) => {
    const $tr = $(tr);
    const tds = $tr.find('td');
    const tdCount = tds.length;

    const cancelA = $tr.find('a[data-qa-id*="lnkbutton-Cancel-"]');
    const hasCancel = cancelA.length > 0;
    const qa = hasCancel ? (cancelA.attr('data-qa-id') ?? '') : '';

    if (!hasCancel || !qa) {
      if (process.env.DEBUG && tdCount > 0) {
        const firstCell = tds.first().text().trim().slice(0, 40);
        if (idx < 3 || /page|next|header|pager/i.test(firstCell)) {
          console.log(chalk.gray(`[debug]   skip row ${idx}: no usable cancel link (first cell: "${firstCell}")`));
        }
      }
      return;
    }

    if (tdCount < 6) {
      if (process.env.DEBUG) {
        console.log(chalk.gray(`[debug]   skip row ${idx}: only ${tdCount} <td> cells (need ~6+)`));
      }
      return;
    }

    let member = $(tds[5]).text().replace(/\s+/g, ' ').trim();
    if (!member && tdCount > 4) member = $(tds[4]).text().replace(/\s+/g, ' ').trim();
    if (!member && tdCount > 6) member = $(tds[6]).text().replace(/\s+/g, ' ').trim();

    const activity = $(tds[0]).text().replace(/\s+/g, ' ').trim();
    const date = $(tds[1]).text().replace(/\s+/g, ' ').trim();
    const time = $(tds[2]).text().replace(/\s+/g, ' ').trim();
    const site = tdCount > 3 ? $(tds[3]).text().replace(/\s+/g, ' ').trim() : '';
    const status = inferSectionStatus($table, qa);

    if (process.env.DEBUG) {
      console.log(
        chalk.gray(
          `[debug]   accepted row ${idx}: ${date} ${time} "${activity}" member="${member || '(empty)'}" status="${status}"`
        )
      );
    }

    rows.push({
      activity,
      date,
      time,
      site,
      member,
      cancelQaId: qa,
      status,
    });
  });
}

/** Parse rows from Manage Bookings (mrmViewMyBookings.aspx). */
export function parseManageBookings(html: string): ManageBookingRow[] {
  const $ = cheerio.load(html);
  const rows: ManageBookingRow[] = [];

  const tables = $('table[id*="gvBookings"]');
  if (tables.length === 0) {
    if (process.env.DEBUG) console.log(chalk.gray('[debug] parseManageBookings: no gvBookings table found'));
    return rows;
  }

  if (process.env.DEBUG) {
    console.log(chalk.gray(`[debug] parseManageBookings: found ${tables.length} gvBookings table(s)`));
  }

  tables.each((tableIdx, table) => {
    parseManageBookingsTable($, table, tableIdx, rows);
  });

  if (process.env.DEBUG) {
    console.log(chalk.gray(`[debug] parseManageBookings: extracted ${rows.length} usable rows`));
    const membersSeen = [...new Set(rows.map((r) => r.member).filter(Boolean))];
    if (membersSeen.length > 0) {
      console.log(chalk.gray(`[debug]   members seen in this page: ${membersSeen.join(', ')}`));
    }
  }

  return rows;
}

/**
 * Find a "next page" control in the current Manage Bookings GridView pager.
 * Supports common ASP.NET patterns (visible "Next", numeric page links, __doPostBack hints).
 * Returns the first enabled-looking locator or null.
 */
async function findNextPageControl(page: Page): Promise<import('playwright').Locator | null> {
  // Try common visible "Next" / arrow controls first (fast path)
  const nextText = page.locator('a:has-text("Next"), a[title*="Next" i], a:has-text(">"), a[title=">"], a[aria-label*="next" i]').first();
  if (await nextText.isVisible().catch(() => false)) {
    const disabled = await nextText.getAttribute('disabled').catch(() => null) ||
      await nextText.evaluate((el) => el.classList.contains('disabled') || el.getAttribute('aria-disabled') === 'true').catch(() => false);
    if (!disabled) return nextText;
  }

  // Look for pager container with page numbers; pick the first link that looks like a higher page or "Next"
  const pagerLinks = page.locator('table[id*="gvBookings"] ~ * a, .GridPager a, [id*="gvBookings_pager"] a, td:has-text("Page") a');
  const count = await pagerLinks.count().catch(() => 0);
  for (let i = 0; i < Math.min(count, 10); i++) {
    const link = pagerLinks.nth(i);
    const txt = (await link.textContent().catch(() => ''))?.trim() ?? '';
    const href = (await link.getAttribute('href').catch(() => '')) ?? '';
    if (/next|>|»/i.test(txt) || /Page\$\d+/i.test(href) || /\b\d+\b/.test(txt)) {
      const vis = await link.isVisible().catch(() => false);
      if (vis) return link;
    }
  }

  // Last resort: any __doPostBack link that smells like pagination (rarely the only option)
  const postback = page.locator('a[href*="__doPostBack"][href*="Page"]').first();
  if (await postback.isVisible().catch(() => false)) return postback;

  return null;
}

/**
 * Navigate to Manage Bookings and collect *all* rows by following GridView pagination.
 * Deduplicates across pages while preserving different members on the same session.
 * (Recurring classes often share the same cancelQaId/ActivityID for multiple household members.)
 * Use this for list_bookings flows that need complete household attribution.
 */
export async function collectManageBookingRows(page: Page): Promise<ManageBookingRow[]> {
  await page.goto(MANAGE_BOOKINGS_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await ensureNoErrorPage(page, 'manage-bookings');

  const allRows: ManageBookingRow[] = [];
  const seen = new Set<string>();
  let pages = 0;
  const MAX_PAGES = 25; // safety cap for very large histories

  while (pages < MAX_PAGES) {
    pages++;
    const html = await page.content();
    const pageRows = parseManageBookings(html);

    let added = 0;
    for (const r of pageRows) {
      // Key must include member name.
      // On recurring bookings the cancelQaId is often the shared ActivityID for the whole series,
      // so we cannot rely on it alone for uniqueness — otherwise we lose the second household member.
      const key = `${r.date}|${r.time}|${normalizeActivity(r.activity)}|${r.member}|${r.cancelQaId || ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        allRows.push(r);
        added++;
      }
    }

    if (process.env.DEBUG) {
      console.log(chalk.gray(`[debug] Manage Bookings page ${pages}: +${added} new rows (total ${allRows.length})`));
    }

    const next = await findNextPageControl(page);
    if (!next) {
      if (process.env.DEBUG) console.log(chalk.gray(`[debug] No more pager controls after ${pages} page(s)`));
      break;
    }

    try {
      await next.click({ timeout: 5000 });
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(250); // small settle for ASP.NET postbacks
    } catch (e) {
      if (process.env.DEBUG) console.log(chalk.gray(`[debug] Pager click failed or no more pages: ${e}`));
      break;
    }
  }

  if (process.env.DEBUG && pages > 1) {
    console.log(chalk.gray(`[debug] Collected ${allRows.length} rows across ${pages} pages from Manage Bookings`));
  }

  return allRows;
}

function cancelIdFromQa(qa: string): string | undefined {
  return qa.match(/Cancel-ID(\S+)/)?.[1];
}

export function findMatchingManageBookingRow(
  rows: ManageBookingRow[],
  options: CancelBookingOptions
): ManageBookingRow {
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

  const rows = await collectManageBookingRows(page);
  if (rows.length === 0) {
    throw new Error('No cancellable bookings found on Manage Bookings page.');
  }

  const row = findMatchingManageBookingRow(rows, {
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
