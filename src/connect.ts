import type { Page } from 'playwright';
import chalk from 'chalk';
import fs from 'fs';

export const MEMBER_HOME_URL = 'https://book.everyoneactive.com/Connect/memberHomePage.aspx';
export const SELECT_SITE_URL = 'https://book.everyoneactive.com/Connect/mrmSelectSite.aspx';

/** Preferred centre name from .env (EA_SITE or SITE). Empty = use portal "Preferred Booking Site". */
export function preferredSiteName(): string {
  return process.env.EA_SITE?.trim() || process.env.SITE?.trim() || '';
}

/**
 * If the portal shows the site picker, click the preferred site (or EA_SITE) so booking
 * flows land on the in-centre activity catalogue instead of the national virtual list.
 */
export async function ensurePreferredSite(page: Page): Promise<void> {
  if (!/mrmSelectSite\.aspx/i.test(page.url())) return;

  const named = preferredSiteName();
  let siteBtn = named
    ? page.locator(`input.BookingLinkButton[value="${named}"]`).first()
    : page.locator('.greybox input.BookingLinkButton, .formatlayout.greybox input.BookingLinkButton').first();

  if (named && !(await siteBtn.isVisible().catch(() => false))) {
    if (process.env.DEBUG) {
      console.log(chalk.yellow(`[debug] Site "${named}" not found; using portal preferred site`));
    }
    siteBtn = page.locator('.greybox input.BookingLinkButton, .formatlayout.greybox input.BookingLinkButton').first();
  }

  if (!(await siteBtn.isVisible().catch(() => false))) return;

  const label = named || (await siteBtn.getAttribute('value')) || 'preferred site';
  if (process.env.DEBUG) console.log(chalk.gray(`[debug] Selecting booking site: ${label}`));

  await siteBtn.click();
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForURL(/mrmselectActivityGroup\.aspx/i, { timeout: 30000 }).catch(() => {});
}

/**
 * Guard that checks the current page for ASP.NET error / exception titles or body text.
 * If detected, saves a full-page screenshot + HTML dump and throws a descriptive error.
 */
export async function ensureNoErrorPage(page: Page, context: string): Promise<void> {
  const title = (await page.title()).toLowerCase();
  const bodyText = (await page.textContent('body').catch(() => '')) || '';
  const looksLikeError =
    title.includes('exception') ||
    /an error has occurred/i.test(bodyText) ||
    /server error in/i.test(bodyText) ||
    (title.includes('error') && !title.includes('everyone active'));

  if (!looksLikeError) return;

  const safeContext = context.replace(/[^a-z0-9_-]/gi, '_');
  const pngPath = `.eacli-session/last-${safeContext}-error.png`;
  const htmlPath = `.eacli-session/last-${safeContext}-error.html`;

  try {
    fs.mkdirSync('.eacli-session', { recursive: true });
    await page.screenshot({ path: pngPath, fullPage: true });
    fs.writeFileSync(htmlPath, await page.content());
    if (process.env.DEBUG) {
      console.log(chalk.gray(`[debug] Saved error diagnostics to ${pngPath} and ${htmlPath}`));
    }
  } catch {}

  throw new Error(
    `Everyone Active site returned an error page at ${context}. Debug artifacts saved to .eacli-session/. Re-run with --debug for more details.`
  );
}