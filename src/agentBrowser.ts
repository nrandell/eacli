import { spawn } from 'node:child_process';
import fs from 'node:fs';
import chalk from 'chalk';
import * as cheerio from 'cheerio';
import {
  groupBookingsBySession,
  parseUpcomingBookings,
  type Booking,
} from './bookings.js';
import { MANAGE_BOOKINGS_URL, parseManageBookings } from './cancelBooking.js';
import { parseFavourites } from './favourites.js';

const STATE_FILE = '.eacli-agent-state.json';
const LOGIN_URL = 'https://book.everyoneactive.com/Connect/mrmLogin.aspx';
const MEMBER_HOME_URL = 'https://book.everyoneactive.com/Connect/memberHomePage.aspx';

export interface QuickBookOption {
  label: string;
  href?: string;
  value?: string;
}

function runCmd(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    if (process.env.DEBUG) console.log(chalk.gray(`[agent-browser] ${['agent-browser', ...args].join(' ')}`));
    const proc = spawn('agent-browser', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d; });
    proc.stderr.on('data', (d) => { stderr += d; });
    proc.on('close', (code) => {
      if (process.env.DEBUG && stderr.trim()) console.log(chalk.gray(`[agent-browser] ${stderr.trim()}`));
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`agent-browser ${args[0]} failed (exit ${code}): ${stderr.trim()}`));
    });
    proc.on('error', (err) => reject(new Error(`Failed to spawn agent-browser: ${err.message}`)));
  });
}

async function loadState(): Promise<boolean> {
  if (!fs.existsSync(STATE_FILE)) return false;
  try {
    await runCmd(['state', 'load', STATE_FILE]);
    if (process.env.DEBUG) console.log(chalk.gray('[debug] Loaded agent-browser state'));
    return true;
  } catch {
    return false;
  }
}

async function saveState(): Promise<void> {
  try {
    await runCmd(['state', 'save', STATE_FILE]);
    if (process.env.DEBUG) console.log(chalk.gray('[debug] Saved agent-browser state'));
  } catch (e) {
    if (process.env.DEBUG) console.error(chalk.gray('[debug] Failed to save state'), e);
  }
}

async function checkLoggedIn(): Promise<boolean> {
  await runCmd(['open', MEMBER_HOME_URL]);
  const html = await runCmd(['get', 'html', 'body']);
  const $ = cheerio.load(html);
  return $('input[name="ctl00$MainContent$InputPassword"]').length === 0;
}

async function doLogin(username: string, password: string): Promise<void> {
  console.log(chalk.blue('Logging in via agent-browser...'));
  await runCmd(['open', LOGIN_URL]);
  await runCmd(['fill', '#ctl00_MainContent_InputLogin', username]);
  await runCmd(['fill', '#ctl00_MainContent_InputPassword', password]);
  await runCmd(['click', '#ctl00_MainContent_btnLogin']);

  const html = await runCmd(['get', 'html', 'body']);
  const $ = cheerio.load(html);

  if ($('input[name="ctl00$MainContent$InputPassword"]').length > 0) {
    const err = $('#ctl00_MainContent_FailureText, [id$="FailureText"]').first().text().trim();
    throw new Error(err || 'Login failed: still on login page after attempting login');
  }

  console.log(chalk.green('Login successful.'));
}

export function parseQuickBookOptions(html: string): QuickBookOption[] {
  return parseFavourites(html).map((f) => {
    const opt: QuickBookOption = { label: f.name };
    if (f.activityId !== undefined) opt.value = f.activityId;
    return opt;
  });
}

export async function getBookingsAgentBrowser(): Promise<Booking[]> {
  try {
    await runCmd(['--version']);
  } catch {
    throw new Error(
      'agent-browser not found on PATH. Install it with:\n  npm install -g agent-browser && agent-browser install'
    );
  }

  const stateLoaded = await loadState();
  if (process.env.DEBUG) console.log(chalk.gray(`[debug] State file loaded: ${stateLoaded}`));

  const loggedIn = await checkLoggedIn();

  if (!loggedIn) {
    if (stateLoaded) console.log(chalk.yellow('Saved session expired, re-authenticating...'));
    const username = process.env.USERNAME;
    const password = process.env.PASSWORD;
    if (!username || !password) throw new Error('USERNAME and PASSWORD must be set in .env');
    await doLogin(username, password);
  } else {
    console.log(chalk.green('Using saved session.'));
  }

  await runCmd(['open', MANAGE_BOOKINGS_URL]);
  let bodyHtml = await runCmd(['get', 'html', 'body']);

  if (process.env.DEBUG) {
    fs.mkdirSync('.eacli-session', { recursive: true });
    fs.writeFileSync('.eacli-session/last-manage-bookings.html', bodyHtml);
    console.log(chalk.gray('[debug] Saved Manage Bookings HTML to .eacli-session/last-manage-bookings.html'));
  }

  // Note: agent-browser path uses single-page parse only (no JS-driven pagination traversal like the Playwright collectManageBookingRows path).
  const rows = parseManageBookings(bodyHtml);
  let bookings = groupBookingsBySession(rows);

  if (bookings.length === 0) {
    await runCmd(['open', MEMBER_HOME_URL]);
    bodyHtml = await runCmd(['get', 'html', 'body']);

    const quickBookOptions = parseQuickBookOptions(bodyHtml);
    if (quickBookOptions.length > 0) {
      if (process.env.DEBUG) {
        console.log(chalk.gray(`[debug] Quick book options (${quickBookOptions.length}):`));
        for (const opt of quickBookOptions) {
          console.log(chalk.gray(`  - ${opt.label}${opt.href ? ` → ${opt.href}` : ''}`));
        }
      } else {
        console.log(chalk.cyan(`Quick book shortcuts: ${quickBookOptions.map((o) => o.label).join(', ')}`));
      }
    }

    bookings = parseUpcomingBookings(bodyHtml);
    if (process.env.DEBUG) {
      console.log(
        chalk.yellow(
          `[debug] Manage Bookings empty; fallback upcoming panel: ${bookings.length} booking(s)`
        )
      );
    }
  }

  if (process.env.DEBUG) {
    console.log(chalk.gray(`[debug] Extracted ${bookings.length} booking(s)`));
  }

  await saveState();
  return bookings;
}
