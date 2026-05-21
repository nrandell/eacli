import type { Page } from 'playwright';
import chalk from 'chalk';
import fs from 'fs';
import { ensureNoErrorPage } from './connect.js';
import { openClassStatus, waitForClassStatusContent } from './classStatus.js';
import {
  formatEaDateLabel,
  parseSessionDateLabel,
  resolveTargetDate,
  sameCalendarDay,
} from './favourites.js';
import { resolveMember } from './members.js';

export interface BookClassOptions {
  memberName: string;
  activity: string;
  date: string;
}

export interface BookClassResult {
  member: string;
  activity: string;
  sessionLabel: string;
  confirmed: boolean;
  waitlisted: boolean;
}

async function confirmBookingBasket(page: Page): Promise<boolean> {
  try {
    await page.waitForURL(/mrmConfirmBooking\.aspx/i, { timeout: 30000 });
  } catch {
    throw new Error('Booking basket did not load after clicking Book');
  }
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await ensureNoErrorPage(page, 'confirm-booking');

  const summary = (await page.locator('#ctl00_MainContent_gvBookings').textContent())?.trim() ?? '';
  if (process.env.DEBUG) console.log(chalk.gray(`[debug] Booking summary: ${summary.slice(0, 200)}`));

  const confirmBtn = page.locator('#ctl00_MainContent_btnBasket, input[data-qa-id="button-basket"]').first();
  await confirmBtn.waitFor({ state: 'visible', timeout: 15000 });
  await confirmBtn.click();
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);

  const finalUrl = page.url();
  const bodyText = (await page.textContent('body')) ?? '';
  return (
    /booking confirmed|successfully booked|thank you|booking complete/i.test(bodyText) ||
    /memberHomePage|mrmViewMyBookings/i.test(finalUrl)
  );
}

/** Book a Group Exercise class for a member on a given date (browse or QuickBook). */
export async function bookClass(page: Page, options: BookClassOptions): Promise<BookClassResult> {
  const targetDate = resolveTargetDate(options.date);
  const dateLabel = formatEaDateLabel(targetDate);
  const member = await resolveMember(page, options.memberName);

  const opened = await openClassStatus(page, {
    ...(member?.name ? { memberName: member.name } : {}),
    activity: options.activity,
    date: options.date,
  });

  if (process.env.DEBUG) {
    console.log(chalk.gray(`[debug] Activity: ${opened.activityLabel} (via ${opened.source})`));
    console.log(chalk.gray(`[debug] Target date: ${dateLabel}`));
    if (opened.pageMessage) console.log(chalk.gray(`[debug] Page message: ${opened.pageMessage}`));
  }

  await ensureNoErrorPage(page, 'class-status');
  await waitForClassStatusContent(page);

  const rows = page.locator('#ClassStatusWrapper .motion.div-row, #ClassStatusWrapper .col-xs-12.div-row');
  const count = await rows.count();
  let matchedRow: ReturnType<Page['locator']> | null = null;
  let sessionLabel = '';

  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const heading = (await row.locator('h4').first().textContent())?.trim() ?? '';
    const sessionDate = parseSessionDateLabel(heading);
    if (sessionDate && sameCalendarDay(sessionDate, targetDate)) {
      matchedRow = row;
      sessionLabel = heading;
      break;
    }
    if (!matchedRow && heading.toLowerCase().includes(dateLabel.toLowerCase())) {
      matchedRow = row;
      sessionLabel = heading;
    }
  }

  if (!matchedRow) {
    const available: string[] = [];
    for (let i = 0; i < count; i++) {
      const h = (await rows.nth(i).locator('h4').first().textContent())?.trim();
      if (h) available.push(h);
    }
    throw new Error(
      `No session on ${dateLabel} for ${opened.activityLabel}. Available sessions: ${available.join('; ') || 'none'}`
    );
  }

  const bookBtn = matchedRow.locator('input.btn-success[value="Book"], input[id*="btnBook"]').first();
  const availBtn = matchedRow.locator('input[id*="btnAvaliable"], input[id*="btnAvailable"]').first();
  const waitBtn = matchedRow.locator('input[id*="Wait"], input[value*="aitlist" i]').first();

  let waitlisted = false;
  if (await bookBtn.isVisible().catch(() => false)) {
    await bookBtn.click();
  } else if (await availBtn.isVisible().catch(() => false)) {
    await availBtn.click();
  } else if (await waitBtn.isVisible().catch(() => false)) {
    await waitBtn.click();
    waitlisted = true;
  } else {
    throw new Error(`Session ${sessionLabel} has no Book or Waitlist button (may be full).`);
  }

  const confirmed = await confirmBookingBasket(page);

  if (process.env.DEBUG) {
    console.log(chalk.gray(`[debug] Final URL: ${page.url()}`));
    fs.mkdirSync('.eacli-session', { recursive: true });
    fs.writeFileSync('.eacli-session/last-book-result.html', await page.content());
  }

  return {
    member: member?.name ?? options.memberName,
    activity: opened.activityLabel,
    sessionLabel,
    confirmed,
    waitlisted,
  };
}
