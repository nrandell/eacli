import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import dotenv from 'dotenv';
import chalk from 'chalk';
import { MEMBER_HOME_URL } from './connect.js';

dotenv.config({ quiet: true });

const SESSION_DIR = '.eacli-session';
const AUTH_STATE_FILE = '.eacli-auth-state.json';
const LOGIN_URL = 'https://book.everyoneactive.com/Connect/mrmLogin.aspx';
const CONNECT_URL = 'https://book.everyoneactive.com/Connect/';

export interface AuthResult {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

export interface AuthOptions {
  /** Clear saved session and log in again (used by `eacli login`). */
  forceLogin?: boolean;
}

/** Persist cookies/localStorage so the next run can skip login. */
export async function saveAuthState(context: BrowserContext): Promise<void> {
  await context.storageState({ path: AUTH_STATE_FILE });
  if (process.env.DEBUG) console.log(chalk.gray(`[debug] Session saved to ${AUTH_STATE_FILE}`));
}

/** Save session and close the browser. */
export async function closeAuthenticated(auth: AuthResult): Promise<void> {
  try {
    await saveAuthState(auth.context);
  } catch {}
  await auth.context.close();
  await auth.browser.close();
}

export async function getAuthenticatedContext(options: AuthOptions = {}): Promise<AuthResult> {
  if (!existsSync(SESSION_DIR)) {
    mkdirSync(SESSION_DIR, { recursive: true });
  }

  if (options.forceLogin && existsSync(AUTH_STATE_FILE)) {
    unlinkSync(AUTH_STATE_FILE);
    if (process.env.DEBUG) console.log(chalk.gray('[debug] Cleared saved session (force login)'));
  }

  const browser = await chromium.launch({ headless: !process.env.DEBUG });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    ...(existsSync(AUTH_STATE_FILE) ? { storageState: AUTH_STATE_FILE } : {}),
  });

  const page = await context.newPage();

  await page.goto(MEMBER_HOME_URL, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

  let loginFormVisible = await isLoginFormVisible(page);

  if (!loginFormVisible && !(await isLoggedIn(page))) {
    await page.goto(CONNECT_URL, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    loginFormVisible = await isLoginFormVisible(page);
  }

  if (loginFormVisible || !(await isLoggedIn(page))) {
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
    loginFormVisible = await isLoginFormVisible(page);
  }

  if (loginFormVisible) {
    console.log('Logging in to Everyone Active...');
    await performLogin(page);
    console.log('Login successful.');
    await saveAuthState(context);
  } else {
    console.log('Using existing session.');
  }

  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

  if (!(await isLoggedIn(page)) || page.url().includes('mrmLogin.aspx')) {
    await page.goto(MEMBER_HOME_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  }

  await handleCentreSelection(page);
  await ensureNoErrorPage(page, 'post-login dashboard');

  return { browser, context, page };
}

async function performLogin(page: Page): Promise<void> {
  const username = process.env.USERNAME;
  const password = process.env.PASSWORD;

  if (!username || !password) {
    throw new Error('USERNAME and PASSWORD must be set in .env file');
  }

  const emailField = page.locator(
    '#ctl00_MainContent_InputLogin, input[name="ctl00$MainContent$InputLogin"], input[placeholder="Email Address"]'
  );
  const passField = page.locator(
    '#ctl00_MainContent_InputPassword, input[name="ctl00$MainContent$InputPassword"], input[placeholder="Password"]'
  );
  const submitBtn = page.locator('#ctl00_MainContent_btnLogin, input[name="ctl00$MainContent$btnLogin"]');

  if (await emailField.isVisible().catch(() => false)) {
    await emailField.fill(username);
  } else {
    await page.locator('input[type="text"]').first().fill(username);
  }

  if (await passField.isVisible().catch(() => false)) {
    await passField.fill(password);
  } else {
    throw new Error('Could not locate password field on login page');
  }

  const jsEnabled = page.locator('#ctl00_MainContent_JavascriptEnabled');
  if (await jsEnabled.isVisible().catch(() => false)) {
    await jsEnabled.fill('1');
  }

  if (await submitBtn.isVisible().catch(() => false)) {
    await Promise.all([
      page.waitForNavigation({ timeout: 30000, waitUntil: 'domcontentloaded' }).catch(() => {}),
      submitBtn.click(),
    ]);
  } else {
    await page.locator('input[type="password"]').first().press('Enter');
  }

  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1200);

  const currentUrl = page.url();
  const stillOnLoginPage =
    currentUrl.includes('mrmLogin.aspx') || currentUrl.includes('/Login') || currentUrl.includes('login.aspx');

  if (stillOnLoginPage) {
    const failureLocator = page
      .locator(
        '#ctl00_MainContent_FailureText, [id$="FailureText"], .failureNotification, [style*="color:red"], text=/login attempt|invalid|unsuccessful|incorrect|error/i'
      )
      .first();

    if (await failureLocator.isVisible().catch(() => false)) {
      const msg = (await failureLocator.textContent())?.trim();
      throw new Error(`Login failed: ${msg || 'Invalid username or password'}`);
    }

    const genericError = page.locator('text=/invalid|unsuccessful|try again|error/i').first();
    if (await genericError.isVisible().catch(() => false)) {
      const msg = (await genericError.textContent())?.trim();
      if (msg && msg.length < 200) {
        throw new Error(`Login failed: ${msg}`);
      }
    }

    try {
      await page.screenshot({ path: '.eacli-session/last-login-failure.png', fullPage: true });
    } catch {}
    throw new Error(
      `Login failed: still on login page after submit (URL: ${currentUrl}). Check credentials or site structure change. Screenshot saved to .eacli-session/last-login-failure.png`
    );
  }
}

async function isLoginFormVisible(page: Page): Promise<boolean> {
  if (page.url().includes('mrmLogin.aspx') || page.url().includes('login.aspx')) {
    return page
      .locator('#ctl00_MainContent_InputPassword, input[name="ctl00$MainContent$InputPassword"]')
      .first()
      .isVisible()
      .catch(() => false);
  }
  return page.locator('input[type="password"]').first().isVisible().catch(() => false);
}

async function isLoggedIn(page: Page): Promise<boolean> {
  if (page.url().includes('mrmLogin.aspx') || page.url().includes('login.aspx')) return false;
  const onMemberHome = page.url().includes('memberHomePage.aspx');
  const portalMarkers = await Promise.all([
    page.locator('#upcomingPanel, #linkedMembers, #collapseQuickBook').first().isVisible().catch(() => false),
    page.locator('#ctl00_LoginControl_Logoutlnk, a[href*="logout.aspx" i]').first().isVisible().catch(() => false),
    page.locator('#ctl00_lblFullName, [data-qa-id="label-memberNameMasterPage"]').first().isVisible().catch(() => false),
  ]);
  if (portalMarkers.some(Boolean)) return true;
  return onMemberHome && !(await isLoginFormVisible(page));
}

async function handleCentreSelection(page: Page): Promise<void> {
  try {
    const centreSelect = page.locator('select[name*="Centre" i], select[id*="Centre" i], select[name*="Site" i]').first();
    const isVisible = await centreSelect.isVisible().catch(() => false);
    if (!isVisible) return;

    const options = await centreSelect.locator('option[value]:not([value=""])').all();
    if (options.length === 0) return;

    const firstOption = options[0];
    if (!firstOption) return;
    const centreValue = (await firstOption.getAttribute('value')) || (await firstOption.textContent())?.trim() || '';
    if (!centreValue) return;

    if (process.env.DEBUG) console.log(chalk.gray(`[debug] Centre selector found, selecting: ${centreValue}`));

    await centreSelect.selectOption(centreValue).catch(() => {});

    const submitBtn = page
      .locator(
        'input[type="submit"][value*="Select" i], input[type="submit"][value*="Go" i], button:has-text("Select"), button:has-text("Go")'
      )
      .first();
    if (await submitBtn.isVisible().catch(() => false)) {
      await Promise.all([
        page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {}),
        submitBtn.click().catch(() => {}),
      ]);
    } else {
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(800);
    }
  } catch (e) {
    if (process.env.DEBUG) console.log(chalk.gray('[debug] Centre selection attempt failed (non-fatal):'), e);
  }
}

async function ensureNoErrorPage(page: Page, context: string): Promise<void> {
  try {
    const title = (await page.title()).toLowerCase();
    const bodyText = (await page.textContent('body').catch(() => '')) || '';
    const looksLikeError =
      title.includes('exception') ||
      title.includes('error') ||
      /an error has occurred/i.test(bodyText) ||
      /server error/i.test(bodyText);

    if (!looksLikeError) return;

    const { writeFileSync } = await import('fs');
    const safeContext = context.replace(/[^a-z0-9_-]/gi, '_');
    const pngPath = `.eacli-session/last-${safeContext}-error.png`;
    const htmlPath = `.eacli-session/last-${safeContext}-error.html`;

    try {
      await page.screenshot({ path: pngPath, fullPage: true });
    } catch {}
    try {
      writeFileSync(htmlPath, await page.content());
    } catch {}

    if (process.env.DEBUG) {
      console.log(chalk.gray(`[debug] Saved error diagnostics to ${pngPath} and ${htmlPath}`));
    }

    throw new Error(
      `Everyone Active site returned an error page at ${context}. Debug artifacts saved to .eacli-session/. Re-run with --debug for more details.`
    );
  } catch (e) {
    if (e instanceof Error && e.message.includes('Everyone Active site returned an error page')) {
      throw e;
    }
  }
}
