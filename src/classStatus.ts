import type { Page } from 'playwright';
import * as cheerio from 'cheerio';
import chalk from 'chalk';
import { MEMBER_HOME_URL, ensureNoErrorPage } from './connect.js';
import {
  collectFavouritesForMember,
  findFavourite,
  resolveTargetDate,
  type Favourite,
} from './favourites.js';
import { resolveMember, type LinkedMember } from './members.js';

const SELECT_SITE_URL = 'https://book.everyoneactive.com/Connect/mrmselectsite.aspx?disableSiteSelection=1';
const GROUP_EXERCISE_SELECTOR = '#ctl00_MainContent_activityGroupsGrid_ctrl8_lnkListCommand, [data-qa-id="button-ActivityID=166GRPEX"]';

export type SessionStatus = 'available' | 'waitlist' | 'full' | 'unknown';

export interface ClassSession {
  when: string;
  duration?: string;
  status: SessionStatus;
  detail: string;
  activityId?: string;
  resourceId?: string;
  scheduledAt?: string;
}

function parseQaId(qa: string): { activityId?: string; resourceId?: string; status?: string; scheduledAt?: string } {
  const out: { activityId?: string; resourceId?: string; status?: string; scheduledAt?: string } = {};
  for (const part of qa.split(/\s+/)) {
    const [k, v] = part.split('=');
    if (!k || !v) continue;
    if (k === 'ActivityID') out.activityId = v;
    if (k === 'ResourceID') out.resourceId = v;
    if (k === 'Status') out.status = v;
    if (k === 'Date') out.scheduledAt = v;
  }
  return out;
}

/** Parse session rows from mrmClassStatus.aspx (#ClassStatusWrapper). */
export function parseClassStatusSessions(html: string): ClassSession[] {
  const $ = cheerio.load(html);
  const sessions: ClassSession[] = [];

  $('#ClassStatusWrapper .col-xs-12.div-row').each((_, row) => {
    const $row = $(row);
    const when = $row.find('h4').first().text().replace(/\s+/g, ' ').trim();
    if (!when) return;

    const duration = $row.find('h4').eq(1).text().replace(/[()]/g, '').trim();
    const bookBtn = $row.find('input[id*="btnBook"], input.btn-success[value="Book"]');
    const availBtn = $row.find('input[id*="btnAvaliable"], input[id*="btnAvailable"]');
    const waitBtn = $row.find('input[id*="Wait"], input[value*="aitlist" i]');

    const qa =
      bookBtn.attr('data-qa-id') ?? availBtn.attr('data-qa-id') ?? waitBtn.attr('data-qa-id') ?? '';
    const meta = parseQaId(qa);

    let status: SessionStatus = 'unknown';
    let detail = meta.status || 'No action available';
    const waitVal = waitBtn.attr('value') ?? '';
    if (waitBtn.length > 0 || /waitlist/i.test(waitVal) || /waitlist/i.test(meta.status ?? '')) {
      status = 'waitlist';
      detail = waitVal || 'Waitlist';
    } else if (bookBtn.length > 0) {
      status = 'available';
      detail = bookBtn.attr('value') || 'Book';
    } else if (availBtn.length > 0) {
      status = 'available';
      detail = availBtn.attr('value') || 'Spaces available';
    } else if (/full/i.test(meta.status ?? '')) {
      status = 'full';
      detail = 'Full';
    }

    const session: ClassSession = { when, status, detail };
    if (duration) session.duration = duration;
    if (meta.activityId) session.activityId = meta.activityId;
    if (meta.resourceId) session.resourceId = meta.resourceId;
    if (meta.scheduledAt) session.scheduledAt = meta.scheduledAt;
    sessions.push(session);
  });

  return sessions;
}

export function getClassStatusPageMessage(html: string): string | undefined {
  const $ = cheerio.load(html);
  const alert = $('.alert-warning').first().text().replace(/\s+/g, ' ').trim();
  return alert || undefined;
}

/** Detects page messages from QuickBook/fav path that often hide real slots for secondary members (e.g. Hayley). */
function isMemberContextOrBookedEmptyMessage(msg: string | undefined): boolean {
  if (!msg) return false;
  const m = msg.toLowerCase();
  return /already booked/i.test(msg) || /booking on behalf of|you're booking on behalf/i.test(msg);
}

/** Wait for class status rows or a warning message after navigation. */
export async function waitForClassStatusContent(page: Page): Promise<void> {
  const rows = page.locator('#ClassStatusWrapper .col-xs-12.div-row, #ClassStatusWrapper .motion.div-row');
  const alert = page.locator('#ClassStatusWrapper .alert-warning, .alert-warning').first();
  await Promise.race([
    rows.first().waitFor({ state: 'visible', timeout: 15000 }),
    alert.waitFor({ state: 'visible', timeout: 15000 }),
  ]).catch(() => {});
}

async function openViaFavourite(page: Page, favourite: Favourite): Promise<void> {
  const favLink = favourite.activityId
    ? page.locator(`#collapseQuickBook a[data-qa-id*="ActivityID=${favourite.activityId}"]`).first()
    : page.locator('#collapseQuickBook a.btn-primary').filter({ hasText: new RegExp(favourite.name.split(/\s+/)[0]!, 'i') }).first();

  await favLink.click();
  await page.waitForURL(/mrmClassStatus\.aspx/i, { timeout: 30000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await waitForClassStatusContent(page);
}

function normalizeActivity(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '');
}

/** Activity names from mrmSelectActivity.aspx (Group Exercise list). */
export function parseGroupExerciseActivities(html: string): string[] {
  const $ = cheerio.load(html);
  const names: string[] = [];
  const seen = new Set<string>();

  $('input.BookingLinkButton[type="submit"], input.btn-primary[type="submit"]').each((_, el) => {
    const value = $(el).attr('value')?.replace(/\s+/g, ' ').trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    names.push(value);
  });

  return names;
}

/** Make a Booking → Group Exercise → activity picker. */
export async function navigateToGroupExerciseList(page: Page): Promise<void> {
  await page.goto(SELECT_SITE_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

  const groupBtn = page.locator(GROUP_EXERCISE_SELECTOR).first();
  await groupBtn.waitFor({ state: 'visible', timeout: 15000 });
  await groupBtn.click();
  await page.waitForURL(/mrmSelectActivity\.aspx/i, { timeout: 30000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
}

/** All bookable Group Exercise classes from Make a Booking (not QuickBook favourites). */
export async function listGroupExerciseActivities(page: Page): Promise<string[]> {
  await navigateToGroupExerciseList(page);
  return parseGroupExerciseActivities(await page.content());
}

async function clickActivityOnList(
  page: Page,
  activityQuery: string,
  mode: 'exact' | 'partial'
): Promise<string> {
  if (!/mrmSelectActivity\.aspx/i.test(page.url())) {
    await navigateToGroupExerciseList(page);
  }

  const q = normalizeActivity(activityQuery);
  const buttons = page.locator('input.BookingLinkButton[type="submit"], input.btn-primary[type="submit"]');
  const count = await buttons.count();

  for (let i = 0; i < count; i++) {
    const btn = buttons.nth(i);
    const value = (await btn.getAttribute('value')) ?? '';
    const nv = normalizeActivity(value);
    const matches =
      mode === 'exact'
        ? value === activityQuery || nv === q
        : nv.includes(q) || q.includes(nv);
    if (matches) {
      await btn.click();
      await page.waitForURL(/mrmClassStatus\.aspx/i, { timeout: 30000 });
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      await waitForClassStatusContent(page);
      return value;
    }
  }

  const names: string[] = [];
  for (let i = 0; i < Math.min(count, 20); i++) {
    const v = await buttons.nth(i).getAttribute('value');
    if (v) names.push(v);
  }
  throw new Error(
    `Activity "${activityQuery}" not found under Group Exercise. Examples: ${names.slice(0, 8).join(', ')}${names.length > 8 ? '…' : ''}`
  );
}

async function openViaBrowse(page: Page, activityQuery: string): Promise<string> {
  await navigateToGroupExerciseList(page);
  return clickActivityOnList(page, activityQuery, 'partial');
}

/** Open one Group Exercise activity via browse and return parsed sessions. */
export async function fetchSessionsViaBrowse(
  page: Page,
  activityName: string
): Promise<{ activityLabel: string; sessions: ClassSession[]; pageMessage?: string }> {
  await navigateToGroupExerciseList(page);
  const activityLabel = await clickActivityOnList(page, activityName, 'exact');
  await ensureNoErrorPage(page, 'class-status');
  const html = await page.content();
  const pageMessage = getClassStatusPageMessage(html);
  return {
    activityLabel,
    sessions: parseClassStatusSessions(html),
    ...(pageMessage ? { pageMessage } : {}),
  };
}

export interface OpenClassStatusOptions {
  memberName?: string;
  activity: string;
  /** Prefer a QuickBook favourite matching this day (e.g. saturday). */
  date?: string;
}

/** Open a favourite and return parsed sessions from the class status page. */
export async function fetchSessionsForFavourite(
  page: Page,
  member: LinkedMember | null,
  favourite: Favourite
): Promise<{ sessions: ClassSession[]; pageMessage?: string }> {
  if (member) await resolveMember(page, member.name);
  await openViaFavourite(page, favourite);
  await ensureNoErrorPage(page, 'class-status');
  const html = await page.content();
  const pageMessage = getClassStatusPageMessage(html);
  return {
    sessions: parseClassStatusSessions(html),
    ...(pageMessage ? { pageMessage } : {}),
  };
}

export interface OpenClassStatusResult {
  activityLabel: string;
  source: 'favourite' | 'browse';
  pageMessage?: string;
}

/** Navigate to the class status (slot picker) page for an activity. */
export async function openClassStatus(page: Page, options: OpenClassStatusOptions): Promise<OpenClassStatusResult> {
  const member = await resolveMember(page, options.memberName);
  const favourites = await collectFavouritesForMember(page, member ?? undefined);
  let activityLabel = options.activity;
  let source: 'favourite' | 'browse' = 'browse';

  const targetDate = options.date?.trim() ? resolveTargetDate(options.date) : undefined;

  if (favourites.length > 0) {
    try {
      const favourite = findFavourite(favourites, options.activity, targetDate);
      activityLabel = favourite.name;
      source = 'favourite';
      if (process.env.DEBUG) {
        console.log(chalk.gray(`[debug] Opening class status via QuickBook: ${activityLabel}`));
      }
      await openViaFavourite(page, favourite);
    } catch {
      if (process.env.DEBUG) console.log(chalk.gray('[debug] Favourite not found, using Make a Booking browse'));
      activityLabel = await openViaBrowse(page, options.activity);
      source = 'browse';
    }
  } else {
    activityLabel = await openViaBrowse(page, options.activity);
    source = 'browse';
  }

  await ensureNoErrorPage(page, 'class-status');
  await waitForClassStatusContent(page);

  const html = await page.content();
  const sessions = parseClassStatusSessions(html);
  const pageMessage = getClassStatusPageMessage(html);

  if (sessions.length === 0 && pageMessage && source === 'favourite' && isMemberContextOrBookedEmptyMessage(pageMessage)) {
    if (process.env.DEBUG) {
      console.log(chalk.gray('[debug] QuickBook/favourite showed no slots (may be member context "on behalf of" or already booked); trying browse path'));
    }
    activityLabel = await openViaBrowse(page, options.activity);
    source = 'browse';
    await ensureNoErrorPage(page, 'class-status');
    const msg = getClassStatusPageMessage(await page.content());
    return {
      activityLabel,
      source,
      ...(msg ? { pageMessage: msg } : {}),
    };
  }

  return {
    activityLabel,
    source,
    ...(pageMessage ? { pageMessage } : {}),
  };
}
