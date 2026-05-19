import { spawn } from 'node:child_process';
import fs from 'node:fs';
import chalk from 'chalk';
import * as cheerio from 'cheerio';
import { parseUpcomingBookings, type Booking } from './bookings.js';
import { parseFavourites } from './favourites.js';
import { parseLinkedMembers } from './members.js';

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

  // Read wherever the post-login redirect landed us (don't navigate away — that would discard cookies)
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

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function bookingToDate(date: string, time: string): Date {
  // date: "Sun 10 May", time: "10:30"
  const parts = date.trim().split(/\s+/);
  const day = parseInt(parts[1] ?? '1', 10);
  const monthStr = (parts[2] ?? 'jan').slice(0, 3).toLowerCase();
  const month = MONTHS[monthStr] ?? 0;
  const [h = '0', m = '0'] = time.split(':');
  const now = new Date();
  let year = now.getFullYear();
  if (month < now.getMonth() || (month === now.getMonth() && day < now.getDate())) year++;
  return new Date(year, month, day, parseInt(h, 10), parseInt(m, 10));
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
    await runCmd(['open', MEMBER_HOME_URL]);
  } else {
    console.log(chalk.green('Using saved session.'));
  }

  let bodyHtml = await runCmd(['get', 'html', 'body']);

  if (process.env.DEBUG) {
    fs.mkdirSync('.eacli-session', { recursive: true });
    fs.writeFileSync('.eacli-session/last-member-home.html', bodyHtml);
    console.log(chalk.gray('[debug] Saved member home HTML to .eacli-session/last-member-home.html'));
  }

  const quickBookOptions = parseQuickBookOptions(bodyHtml);
  if (quickBookOptions.length > 0) {
    if (process.env.DEBUG) {
      console.log(chalk.gray(`[debug] Quick book options (${quickBookOptions.length}):`));
      for (const opt of quickBookOptions) {
        console.log(chalk.gray(`  - ${opt.label}${opt.href ? ` → ${opt.href}` : ''}`));
      }
    } else {
      console.log(chalk.cyan(`Quick book shortcuts: ${quickBookOptions.map(o => o.label).join(', ')}`));
    }
  }

  const members = parseLinkedMembers(bodyHtml);
  const allBookings: Booking[] = [];

  if (members.length <= 1) {
    // Single-member account — no member tagging
    allBookings.push(...parseUpcomingBookings(bodyHtml));
  } else {
    // Multi-member: collect bookings for each member in turn
    const selectedFirst = members.find(m => m.selected) ?? members[0];
    const rest = members.filter(m => m.id !== selectedFirst?.id);

    if (process.env.DEBUG) console.log(chalk.gray(`[debug] Members: ${members.map(m => m.name).join(', ')}`));

    // Bookings for the currently-selected member are already on the page
    const firstBookings = parseUpcomingBookings(bodyHtml).map(b => {
      const booking: Booking = { ...b };
      booking.member = selectedFirst?.name ?? '';
      return booking;
    });
    allBookings.push(...firstBookings);

    // Switch to each other member and collect their bookings
    for (const member of rest) {
      if (process.env.DEBUG) console.log(chalk.gray(`[debug] Switching to member: ${member.name} (${member.sliderSelector})`));
      await runCmd(['click', member.sliderSelector]);
      await runCmd(['snapshot']); // wait for AJAX update to settle
      bodyHtml = await runCmd(['get', 'html', 'body']);
      const memberBookings = parseUpcomingBookings(bodyHtml).map(b => {
        const booking: Booking = { ...b };
        booking.member = member.name;
        return booking;
      });
      if (process.env.DEBUG) console.log(chalk.gray(`[debug] ${member.name}: ${memberBookings.length} booking(s)`));
      allBookings.push(...memberBookings);
    }

    // Deduplicate by reference: same session booked by multiple members → merge names
    const seen = new Map<string, Booking>();
    for (const booking of allBookings) {
      const key = booking.reference ?? `${booking.date}|${booking.time}|${booking.activity}`;
      const existing = seen.get(key);
      if (existing) {
        if (booking.member && existing.member && !existing.member.includes(booking.member)) {
          existing.member = `${existing.member}, ${booking.member}`;
        }
      } else {
        seen.set(key, { ...booking });
      }
    }

    const deduped = [...seen.values()];
    deduped.sort((a, b) => bookingToDate(a.date, a.time).getTime() - bookingToDate(b.date, b.time).getTime());
    allBookings.length = 0;
    allBookings.push(...deduped);
  }

  await saveState();
  return allBookings;
}
