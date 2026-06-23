import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import chalk from 'chalk';
import { MEMBER_HOME_URL, ensurePreferredSite } from './connect.js';
import { EacliCommandError } from './output.js';
import {
  hasMultipleProfiles,
  portalNameMatchesProfile,
  legacyAuthStatePath,
  removeLegacyAuthStateIfPresent,
  resolveAuthStatePath,
  resolveProfile,
  type ResolvedProfile,
  type ResolveProfileOptions,
} from './profiles.js';

const SESSION_DIR = '.eacli-session';
const LOGIN_URL = 'https://book.everyoneactive.com/Connect/mrmLogin.aspx';
const CONNECT_URL = 'https://book.everyoneactive.com/Connect/';

export interface AuthResult {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  profile: ResolvedProfile;
}

export interface AuthOptions extends ResolveProfileOptions {
  /** Clear saved session and log in again (used by `eacli login`). */
  forceLogin?: boolean;
}

/** Persist cookies/localStorage so the next run can skip login. */
export async function saveAuthState(context: BrowserContext, profile: ResolvedProfile): Promise<void> {
  const authPath = resolveAuthStatePath(profile.key);
  mkdirSync(SESSION_DIR, { recursive: true });
  await context.storageState({ path: authPath });
  if (authPath !== legacyAuthStatePath()) {
    removeLegacyAuthStateIfPresent();
  }
  if (process.env.DEBUG) console.log(chalk.gray(`[debug] Session saved to ${authPath} (profile: ${profile.key})`));
}

/** Save session and close the browser. */
export async function closeAuthenticated(auth: AuthResult): Promise<void> {
  try {
    await saveAuthState(auth.context, auth.profile);
  } catch {}
  await auth.context.close();
  await auth.browser.close();
}

async function readPortalDisplayName(page: Page): Promise<string | undefined> {
  const locator = page.locator('#ctl00_lblFullName, [data-qa-id="label-memberNameMasterPage"]').first();
  const text = (await locator.textContent().catch(() => null))?.replace(/\s+/g, ' ').trim();
  return text || undefined;
}

async function verifyLoggedInProfile(page: Page, profile: ResolvedProfile): Promise<void> {
  if (profile.verifyLogin === false) return;

  const portalName = await readPortalDisplayName(page);
  if (!portalName) {
    throw new EacliCommandError(
      `Could not read portal display name to verify profile "${profile.key}" (expected "${profile.name}"). Portal markup may have changed — set verifyLogin:false only as a temporary workaround.`,
      'PROFILE_MISMATCH'
    );
  }
  if (!portalNameMatchesProfile(portalName, profile)) {
    throw new EacliCommandError(
      `Logged in as "${portalName}" but profile "${profile.key}" expects "${profile.name}". Check credentials in .eacli-profiles.json.`,
      'PROFILE_MISMATCH'
    );
  }
  if (process.env.DEBUG) {
    console.log(chalk.gray(`[debug] Verified portal identity: ${portalName} (profile: ${profile.key})`));
  }
}

export async function getAuthenticatedContext(options: AuthOptions = {}): Promise<AuthResult> {
  const profile = resolveProfile(options);
  const authStatePath = resolveAuthStatePath(profile.key);

  if (!existsSync(SESSION_DIR)) {
    mkdirSync(SESSION_DIR, { recursive: true });
  }

  if (options.forceLogin && existsSync(authStatePath)) {
    unlinkSync(authStatePath);
    if (process.env.DEBUG) {
      console.log(chalk.gray(`[debug] Cleared saved session for profile "${profile.key}" (force login)`));
    }
  }

  const browser = await chromium.launch({ headless: !process.env.DEBUG });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    ...(existsSync(authStatePath) ? { storageState: authStatePath } : {}),
  });

  const page = await context.newPage();

  if (process.env.DEBUG && hasMultipleProfiles()) {
    console.log(chalk.gray(`[debug] Using profile: ${profile.key} (${profile.name})`));
  }

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
    console.log(`Logging in to Everyone Active as ${profile.name}...`);
    await performLogin(page, profile);
    console.log('Login successful.');
    await saveAuthState(context, profile);
  } else {
    console.log(`Using existing session (${profile.name}).`);
  }

  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

  if (!(await isLoggedIn(page)) || page.url().includes('mrmLogin.aspx')) {
    await page.goto(MEMBER_HOME_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  }

  await verifyLoggedInProfile(page, profile);
  await ensurePreferredSite(page);
  await ensureNoErrorPage(page, 'post-login dashboard');

  return { browser, context, page, profile };
}

async function performLogin(page: Page, profile: ResolvedProfile): Promise<void> {
  const { username, password } = profile;

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
      throw new Error(`Login failed for profile "${profile.key}": ${msg || 'Invalid username or password'}`);
    }

    const genericError = page.locator('text=/invalid|unsuccessful|try again|error/i').first();
    if (await genericError.isVisible().catch(() => false)) {
      const msg = (await genericError.textContent())?.trim();
      if (msg && msg.length < 200) {
        throw new Error(`Login failed for profile "${profile.key}": ${msg}`);
      }
    }

    try {
      await page.screenshot({ path: '.eacli-session/last-login-failure.png', fullPage: true });
    } catch {}
    throw new Error(
      `Login failed for profile "${profile.key}": still on login page after submit (URL: ${currentUrl}). Screenshot saved to .eacli-session/last-login-failure.png`
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