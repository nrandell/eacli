import type { Page } from 'playwright';
import * as cheerio from 'cheerio';
import { printTable } from 'console-table-printer';
import chalk from 'chalk';
import fs from 'fs';
import { MEMBER_HOME_URL, ensureNoErrorPage } from './connect.js';
import { collectManageBookingRows } from './cancelBooking.js';
import { findMemberByName, getMembers, switchMember, type LinkedMember } from './members.js';
import { safeGoto } from './nav.js';

export interface Favourite {
  name: string;
  activityId?: string;
  member?: string;
}

/** Parse QuickBook favourites from the member home page (#collapseQuickBook). */
export function parseFavourites(html: string): Favourite[] {
  const $ = cheerio.load(html);
  const favourites: Favourite[] = [];
  const seen = new Set<string>();

  const add = (name: string, activityId?: string) => {
    const trimmed = name.replace(/\s+/g, ' ').trim();
    if (!trimmed || /book one of these|view information about/i.test(trimmed)) return;
    const key = activityId ?? trimmed;
    if (seen.has(key)) return;
    seen.add(key);
    const fav: Favourite = { name: trimmed };
    if (activityId) fav.activityId = activityId;
    favourites.push(fav);
  };

  // Primary: "Book again" shortcuts in the QuickBook panel
  $('#collapseQuickBook a[data-qa-id*="ActivityID"], #collapseQuickBook a.btn-primary.btn-block').each((_, el) => {
    const name = $(el).text().trim();
    const qa = $(el).attr('data-qa-id') ?? '';
    const activityMatch = qa.match(/ActivityID=([^,\s]+)/i);
    add(name, activityMatch?.[1]);
  });

  if (favourites.length > 0) return favourites;

  // Fallback: any labelled links inside QuickBook
  $('#collapseQuickBook a[href]').each((_, el) => {
    const label = $(el).text().trim();
    add(label);
  });

  return favourites;
}

/** Infer QuickBook-style shortcuts from recurring activities in Manage Bookings. */
export function favouritesFromBookingRows(rows: import('./cancelBooking.js').ManageBookingRow[]): Favourite[] {
  const seen = new Set<string>();
  const favourites: Favourite[] = [];
  for (const row of rows) {
    const name = row.activity.replace(/\s+/g, ' ').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    favourites.push({ name });
  }
  return favourites;
}

export async function collectFavouritesForMember(page: Page, member?: LinkedMember): Promise<Favourite[]> {
  await page.locator('#collapseQuickBook').waitFor({ state: 'attached', timeout: 10000 }).catch(() => {});
  return parseFavourites(await page.content()).map((f) => {
    if (!member) return f;
    return { ...f, member: member.name };
  });
}

/** Fetch QuickBook favourites from the Connect member home page. */
export async function getFavourites(page: Page): Promise<Favourite[]> {
  if (!page.url().includes('memberHomePage.aspx')) {
    await safeGoto(page, MEMBER_HOME_URL, { timeout: 20000, label: 'member-home' });
  }
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await ensureNoErrorPage(page, 'member-home');

  let allFavourites: Favourite[] = await collectFavouritesForMember(page);

  if (allFavourites.length === 0) {
    if (process.env.DEBUG) {
      console.log(chalk.gray('[debug] QuickBook empty — inferring favourites from Manage Bookings'));
    }
    const rows = await collectManageBookingRows(page);
    allFavourites = favouritesFromBookingRows(rows);
  } else {
    const members = await getMembers(page);
    if (members.length > 1 && !members.some((m) => m.derivedFromBookings)) {
      if (process.env.DEBUG) {
        console.log(chalk.gray(`[debug] Members: ${members.map((m) => m.name).join(', ')}`));
      }
      const selectedFirst = members.find((m) => m.selected) ?? members[0]!;
      const rest = members.filter((m) => m.id !== selectedFirst.id);
      allFavourites = await collectFavouritesForMember(page, selectedFirst);

      for (const member of rest) {
        await switchMember(page, member);
        const memberFavs = await collectFavouritesForMember(page, member);
        if (process.env.DEBUG) {
          console.log(chalk.gray(`[debug] ${member.name}: ${memberFavs.length} favourite(s)`));
        }
        allFavourites.push(...memberFavs);
      }
    }
  }

  if (process.env.DEBUG) {
    console.log(chalk.gray(`[debug] Page URL: ${page.url()}`));
    console.log(chalk.gray(`[debug] Found ${allFavourites.length} favourite(s) total`));
  }

  if (allFavourites.length === 0) {
    try {
      fs.mkdirSync('.eacli-session', { recursive: true });
      fs.writeFileSync('.eacli-session/last-favourites-page.html', await page.content());
      if (process.env.DEBUG) {
        console.log(chalk.gray('[debug] Saved HTML to .eacli-session/last-favourites-page.html'));
      }
    } catch {}
  }

  return allFavourites;
}

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function normalizeActivity(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '');
}

/** Strip day/time suffixes agents copy from portal labels. */
function normalizeFavouriteQuery(query: string): string {
  let q = query.trim();
  q = q.replace(
    /\s+(sun|mon|tue|wed|thu|fri|sat|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b.*$/i,
    ''
  );
  q = q.replace(/\s+\d{1,2}:\d{2}.*$/i, '');
  return q.trim() || query.trim();
}

export function findFavourite(favourites: Favourite[], activityQuery: string, targetDate?: Date): Favourite {
  const q = normalizeActivity(normalizeFavouriteQuery(activityQuery));
  let candidates = favourites.filter(
    (f) => normalizeActivity(f.name).includes(q) || q.includes(normalizeActivity(f.name))
  );
  if (candidates.length === 0) {
    throw new Error(
      `No favourite matching "${activityQuery}". Available: ${favourites.map((f) => f.name).join(', ')}`
    );
  }

  if (targetDate && candidates.length > 1) {
    const dayToken = DAY_NAMES[targetDate.getDay()]!;
    const dayMatches = candidates.filter((f) => {
      const n = f.name.toLowerCase();
      return n.includes(dayToken) || n.includes(dayToken.slice(0, 3));
    });
    if (dayMatches.length >= 1) candidates = dayMatches;
  }

  return candidates[0]!;
}

/** Resolve natural-language or ISO dates to a calendar day (local time). */
export function resolveTargetDate(dateInput: string): Date {
  const raw = dateInput.trim().toLowerCase();
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  if (raw === 'today') return now;
  if (raw === 'tomorrow') {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return d;
  }

  const dayMatch = raw.match(/\b(sun|mon|tue|wed|thu|fri|sat|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (dayMatch) {
    const token = dayMatch[1]!;
    const targetDow = DAY_NAMES.indexOf(token.slice(0, 3) as (typeof DAY_NAMES)[number]);
    if (targetDow < 0) throw new Error(`Could not parse day: ${dateInput}`);
    const currentDow = now.getDay();
    let daysAhead = (targetDow - currentDow + 7) % 7;
    if (daysAhead === 0 && /next|coming/.test(raw)) daysAhead = 7;
    const d = new Date(now);
    d.setDate(d.getDate() + daysAhead);
    return d;
  }

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));

  const dmy = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if (dmy) {
    const year = dmy[3]!.length === 2 ? 2000 + Number(dmy[3]) : Number(dmy[3]);
    return new Date(year, Number(dmy[2]) - 1, Number(dmy[1]));
  }

  const parsed = new Date(dateInput);
  if (!Number.isNaN(parsed.getTime())) {
    parsed.setHours(0, 0, 0, 0);
    return parsed;
  }

  throw new Error(`Could not parse date: "${dateInput}". Try "saturday", "2026-05-24", or "24/05/2026".`);
}

export function formatEaDateLabel(d: Date): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
}

export function parseSessionDateLabel(label: string): Date | null {
  // "Sat 23 May, 08:25"
  const m = label.match(/\b(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i);
  if (!m) return null;
  const month = MONTH_NAMES.indexOf(m[3]!.toLowerCase().slice(0, 3));
  if (month < 0) return null;
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let year = now.getFullYear();
  const day = Number(m[2]);
  let sessionDate = new Date(year, month, day);
  // Recent past dates (manage bookings) stay in the current year; older dates roll to next occurrence.
  const daysBehind = (todayStart.getTime() - sessionDate.getTime()) / 86_400_000;
  if (daysBehind > 30) {
    year += 1;
    sessionDate = new Date(year, month, day);
  }
  return sessionDate;
}

export function sameCalendarDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function printFavourites(favourites: Favourite[]): void {
  if (favourites.length === 0) {
    console.log(chalk.yellow('No favourites found (QuickBook panel may be empty).'));
    return;
  }

  console.log(chalk.green(`\n${favourites.length} favourite(s) (QuickBook):\n`));

  const showMember = favourites.some((f) => f.member !== undefined);
  printTable(
    favourites.map((f, idx) => ({
      '#': idx + 1,
      ...(showMember ? { Member: f.member ?? '' } : {}),
      Activity: f.name,
      'Activity ID': f.activityId ?? '-',
    }))
  );
}
