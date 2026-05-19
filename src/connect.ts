import type { Page } from 'playwright';
import chalk from 'chalk';
import fs from 'fs';

export const MEMBER_HOME_URL = 'https://book.everyoneactive.com/Connect/memberHomePage.aspx';

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
