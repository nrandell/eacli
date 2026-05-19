import axios from 'axios';
import { CookieJar } from 'tough-cookie';
import { wrapper } from 'axios-cookiejar-support';
import * as cheerio from 'cheerio';
import fs from 'fs';
import chalk from 'chalk';
import type { Booking } from './bookings.js';
import { parseLinkedMembers } from './members.js';
import type { LinkedMember } from './members.js';

const COOKIE_FILE = '.eacli-cookies.json';
const LOGIN_URL = 'https://book.everyoneactive.com/Connect/mrmLogin.aspx';
const DASHBOARD_URL = 'https://book.everyoneactive.com/Connect/';
const BOOKINGS_URL = 'https://book.everyoneactive.com/Connect/members/bookings.aspx';

const jar = new CookieJar();
const client = wrapper(axios.create({
  jar: jar as any,
  withCredentials: true,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://book.everyoneactive.com/Connect/mrmLogin.aspx',
  },
  maxRedirects: 5,
} as any));

function saveCookies() {
  try {
    const cookies = jar.serializeSync();
    fs.writeFileSync(COOKIE_FILE, JSON.stringify(cookies, null, 2));
    if (process.env.DEBUG) console.log(chalk.gray('[debug] Cookies saved to .eacli-cookies.json'));
  } catch (e) {
    if (process.env.DEBUG) console.error(chalk.gray('[debug] Failed to save cookies'), e);
  }
}

function loadCookies(): boolean {
  try {
    if (!fs.existsSync(COOKIE_FILE)) return false;
    const serialized = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf8'));
    const restored = CookieJar.deserializeSync(serialized);
    const cookies = (restored.toJSON().cookies || []) as any[];
    const now = new Date();
    let loaded = 0;
    for (const c of cookies) {
      try {
        const expires = c.expires ? new Date(c.expires) : null;
        if (expires && expires < now) continue;
        jar.setCookieSync(`${c.key}=${c.value}`, `https://${c.domain}${c.path || '/'}`);
        loaded++;
      } catch {}
    }
    if (process.env.DEBUG) console.log(chalk.gray(`[debug] Loaded ${loaded} cookie(s) from file`));
    return loaded > 0;
  } catch {
    return false;
  }
}

export async function login(username: string, password: string): Promise<boolean> {
  console.log(chalk.blue('Logging in via HTTP client...'));

  // Ensure we start fresh or load existing? For login we force fresh
  jar.removeAllCookiesSync();

  const loginPage = await client.get(LOGIN_URL);
  const $ = cheerio.load(loginPage.data);

  // Extract all hidden fields required by ASP.NET Web Forms
  const formData: Record<string, string> = {};
  $('input[type="hidden"]').each((_, el) => {
    const name = $(el).attr('name');
    const value = $(el).attr('value') || '';
    if (name) formData[name] = value;
  });

  // Set the known login controls
  formData['ctl00$MainContent$InputLogin'] = username;
  formData['ctl00$MainContent$InputPassword'] = password;
  formData['ctl00$MainContent$btnLogin'] = 'Login';
  formData['ctl00$MainContent$JavascriptEnabled'] = '1';

  // Also include any other ctl00 fields if present (some pages have more)
  // The __VIEWSTATE etc are already captured above

  const params = new URLSearchParams();
  Object.entries(formData).forEach(([k, v]) => params.append(k, v));

  // maxRedirects: 0 so the 302 response passes through axios interceptors,
  // letting axios-cookiejar-support capture the auth cookie from Set-Cookie headers.
  // If we let follow-redirects handle the chain automatically the auth cookie is silently dropped.
  const postResp = await client.post(LOGIN_URL, params, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    maxRedirects: 0,
    validateStatus: (s) => s < 400,
  });

  let finalResp;
  if (postResp.status >= 300 && postResp.status < 400) {
    const location = postResp.headers['location'];
    if (!location) throw new Error('Login failed: redirect with no Location header');
    const redirectUrl = location.startsWith('http') ? location : new URL(location, LOGIN_URL).toString();

    if (process.env.DEBUG) console.log(chalk.gray(`[debug] Login redirect → ${redirectUrl}`));

    if (redirectUrl.includes('mrmLogin.aspx')) {
      // Redirected back to login — wrong credentials or locked out
      finalResp = await client.get(redirectUrl);
      const $err = cheerio.load(finalResp.data);
      const err = $err('#ctl00_MainContent_FailureText, [id$="FailureText"], .failureNotification').first().text().trim();
      throw new Error(err || 'Login failed: invalid credentials');
    }

    finalResp = await client.get(redirectUrl);
  } else {
    finalResp = postResp;
  }

  const $resp = cheerio.load(finalResp.data);
  const stillOnLogin =
    $resp('input[name="ctl00$MainContent$InputPassword"]').length > 0 ||
    $resp('#ctl00_MainContent_btnLogin').length > 0;

  if (stillOnLogin) {
    const err = $resp('#ctl00_MainContent_FailureText, [id$="FailureText"], .failureNotification').first().text().trim();
    throw new Error(err || 'Login failed: still on login page after redirect');
  }

  console.log(chalk.green('HTTP login successful.'));
  saveCookies();
  return true;
}

export async function getBookingsHttp(): Promise<Booking[]> {
  const hasCookies = loadCookies();
  if (!hasCookies) {
    const username = process.env.USERNAME;
    const password = process.env.PASSWORD;
    if (!username || !password) throw new Error('USERNAME/PASSWORD required for login');
    await login(username, password);
  }

  // After login, first visit the dashboard / member home to establish context (often required for centre selection)
  if (process.env.DEBUG) console.log(chalk.gray(`[debug] Visiting dashboard: ${DASHBOARD_URL}`));
  let dashboardResp;
  try {
    dashboardResp = await client.get(DASHBOARD_URL, { headers: { Referer: LOGIN_URL } });
  } catch (e) {
    // fallback to root
    dashboardResp = await client.get('https://book.everyoneactive.com/Connect/', { headers: { Referer: LOGIN_URL } });
  }

  let $dash = cheerio.load(dashboardResp.data);

  // Detect expired session — server redirected us back to the login page
  if ($dash('input[name="ctl00$MainContent$InputPassword"]').length > 0) {
    if (process.env.DEBUG) console.log(chalk.gray('[debug] Session expired, re-logging in...'));
    jar.removeAllCookiesSync();
    try { fs.unlinkSync(COOKIE_FILE); } catch {}
    const username = process.env.USERNAME;
    const password = process.env.PASSWORD;
    if (!username || !password) throw new Error('USERNAME/PASSWORD required for re-login after session expiry');
    await login(username, password);
    dashboardResp = await client.get(DASHBOARD_URL, { headers: { Referer: LOGIN_URL } });
    $dash = cheerio.load(dashboardResp.data);
  }

  const dashTitle = $dash('title').text();
  if (process.env.DEBUG) {
    console.log(chalk.gray(`[debug] Dashboard title: ${dashTitle}`));
  }

  // Handle centre / site selection if present (common ASP.NET pattern after login for multi-centre accounts)
  const centreSelect = $dash('select[name*="Centre" i], select[id*="Centre" i], select[name*="Site" i]').first();
  if (centreSelect.length > 0) {
    const centreName = centreSelect.attr('name') || 'ctl00$MainContent$ddlCentre';
    const firstOption = centreSelect.find('option[value]:not([value=""])').first();
    const centreValue = firstOption.attr('value') || firstOption.text().trim();
    if (centreValue) {
      if (process.env.DEBUG) console.log(chalk.gray(`[debug] Centre selector found, selecting: ${centreValue}`));
      const centreForm: Record<string, string> = {};
      $dash('input[type="hidden"]').each((_, el) => {
        const n = $dash(el).attr('name');
        if (n) centreForm[n] = $dash(el).attr('value') || '';
      });
      centreForm[centreName] = centreValue;
      // include any submit button name if needed
      const submitName = $dash('input[type="submit"][value*="Select" i], input[type="submit"][value*="Go" i]').first().attr('name') || '';
      if (submitName) centreForm[submitName] = 'Select';

      const centreParams = new URLSearchParams();
      Object.entries(centreForm).forEach(([k, v]) => centreParams.append(k, v));

      try {
        await client.post(DASHBOARD_URL, centreParams, {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: DASHBOARD_URL },
        });
      } catch {}
    }
  }

  // Discover the actual bookings link from the dashboard if possible
  let targetBookingsUrl = BOOKINGS_URL;
  let bookingsLink = $dash('a[href*="booking" i], a[href*="members/bookings" i]').first();
  if (bookingsLink.length === 0) {
    // Fallback: search links containing the text
    bookingsLink = $dash('a').filter((_, el) => /my bookings|bookings/i.test($dash(el).text())).first();
  }
  if (bookingsLink.length > 0) {
    const href = bookingsLink.attr('href');
    if (href) {
      targetBookingsUrl = href.startsWith('http') ? href : new URL(href, DASHBOARD_URL).toString();
      if (process.env.DEBUG) console.log(chalk.gray(`[debug] Discovered bookings link: ${targetBookingsUrl}`));
    }
  }

  if (process.env.DEBUG) console.log(chalk.gray(`[debug] Fetching bookings from ${targetBookingsUrl}`));

  const resp = await client.get(targetBookingsUrl, { headers: { Referer: DASHBOARD_URL } });
  const $ = cheerio.load(resp.data);
  const pageTitle = $('title').text();

  if (process.env.DEBUG) {
    console.log(chalk.gray(`[debug] Bookings page title: ${pageTitle}`));
    console.log(chalk.gray(`[debug] Found ${$('table').length} tables`));
  }

  // If we hit an exception or error page, save the HTML for debugging (fulfills the "HTML snapshot" requirement)
  if (pageTitle.toLowerCase().includes('exception') || pageTitle.toLowerCase().includes('error') || $('table').length === 0) {
    try {
      fs.mkdirSync('.eacli-session', { recursive: true });
      fs.writeFileSync('.eacli-session/last-bookings-http.html', resp.data);
      console.log(chalk.gray('[debug] Saved response HTML to .eacli-session/last-bookings-http.html for inspection'));
    } catch {}
  }

  const bookings: Booking[] = [];

  // Strategy: look for common ASP.NET GridView / table patterns
  const tableSelectors = [
    'table[id*="Booking" i]',
    'table[id*="Grid" i]',
    'table[class*="grid" i]',
    'table[class*="booking" i]',
    '#ctl00_MainContent_BookingsGrid',
    'table',
  ];

  let rowsFound = false;
  for (const sel of tableSelectors) {
    const tables = $(sel);
    if (tables.length === 0) continue;

    tables.each((_, table) => {
      $(table).find('tr').each((__, tr) => {
        const cells = $(tr).find('td, th').map((___, td) => $(td).text().trim()).get().filter(Boolean);
        if (cells.length >= 4 && !/date|time|activity/i.test(cells[0] || '')) {
          const [date = '', time = '', activity = '', location = '', status = '', reference = ''] = cells;
          if (date && activity) {
            bookings.push({ date, time, activity, location, status, reference });
            rowsFound = true;
          }
        }
      });
    });
    if (rowsFound) break;
  }

  // Fallback: scan for elements containing date patterns + activity keywords
  if (bookings.length === 0) {
    $('*').each((_, el) => {
      const txt = $(el).text();
      if (/\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}/.test(txt) && /class|session|swim|gym|court/i.test(txt) && txt.length < 300) {
        const dateMatch = txt.match(/(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/);
        const timeMatch = txt.match(/(\d{1,2}:\d{2})/);
        bookings.push({
          date: dateMatch?.[1] || 'TBD',
          time: timeMatch?.[1] || '',
          activity: (txt.split('\n')[0] || '').trim().slice(0, 60),
          location: 'Centre',
          status: txt.includes('Cancelled') ? 'Cancelled' : 'Confirmed',
        });
      }
    });
  }

  if (process.env.DEBUG) {
    console.log(chalk.gray(`[debug] Extracted ${bookings.length} booking(s)`));
  }

  return bookings;
}

export async function getMembersHttp(): Promise<LinkedMember[]> {
  const hasCookies = loadCookies();
  if (!hasCookies) {
    const username = process.env.USERNAME;
    const password = process.env.PASSWORD;
    if (!username || !password) throw new Error('USERNAME/PASSWORD required for login');
    await login(username, password);
  }

  if (process.env.DEBUG) console.log(chalk.gray(`[debug] Visiting dashboard: ${DASHBOARD_URL}`));
  let dashboardResp = await client.get(DASHBOARD_URL, { headers: { Referer: LOGIN_URL } });
  let $dash = cheerio.load(dashboardResp.data);

  if ($dash('input[name="ctl00$MainContent$InputPassword"]').length > 0) {
    if (process.env.DEBUG) console.log(chalk.gray('[debug] Session expired, re-logging in...'));
    jar.removeAllCookiesSync();
    try { fs.unlinkSync(COOKIE_FILE); } catch {}
    const username = process.env.USERNAME;
    const password = process.env.PASSWORD;
    if (!username || !password) throw new Error('USERNAME/PASSWORD required for re-login after session expiry');
    await login(username, password);
    dashboardResp = await client.get(DASHBOARD_URL, { headers: { Referer: LOGIN_URL } });
    $dash = cheerio.load(dashboardResp.data);
  }

  const members = parseLinkedMembers(dashboardResp.data);
  if (process.env.DEBUG) console.log(chalk.gray(`[debug] Found ${members.length} linked member(s)`));
  return members;
}
