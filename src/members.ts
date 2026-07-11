import type { Page } from 'playwright';
import * as cheerio from 'cheerio';
import { printTable } from 'console-table-printer';
import chalk from 'chalk';
import fs from 'fs';
import { MEMBER_HOME_URL, ensureNoErrorPage } from './connect.js';
import type { ManageBookingRow } from './cancelBooking.js';
import { safeGoto } from './nav.js';
import { EacliCommandError } from './output.js';
import {
  hasMultipleProfiles,
  memberMatchesProfile,
  type ProfileSummary,
  type ResolvedProfile,
} from './profiles.js';

export interface LinkedMember {
  name: string;
  id: string;
  selected: boolean;
  sliderSelector: string;
  /** Present when member list was inferred from Manage Bookings (no home-page switcher). */
  derivedFromBookings?: boolean;
}

const MEMBER_SWITCH_POLL_MS = 200;
const MEMBER_SWITCH_TIMEOUT_MS = 10000;

export function parseLinkedMembers(html: string): LinkedMember[] {
  const $ = cheerio.load(html);
  const members: LinkedMember[] = [];

  $('#linkedMembers li').each((_, li) => {
    const nameEl = $(li).find('span.LinkedMemberLabel');
    const sliderEl = $(li).find('span.slider');
    const hiddenEl = $(li).find('input[type="hidden"]');
    const name = nameEl.text().trim();
    const sliderId = sliderEl.attr('id') ?? '';
    const idMatch = sliderId.match(/SelectedMemberCheckBox-(\d+)/);
    if (!name || !idMatch) return;
    members.push({
      name,
      id: idMatch[1] ?? '',
      selected: hiddenEl.attr('value') === 'True',
      sliderSelector: `#${sliderId}`,
    });
  });

  return members;
}

/** Build a household member list from Manage Bookings rows when the home-page switcher is gone. */
export function membersFromBookingRows(rows: ManageBookingRow[]): LinkedMember[] {
  const names = [...new Set(rows.map((r) => r.member.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b)
  );
  return names.map((name, index) => ({
    name,
    id: `booking-${index + 1}`,
    selected: index === 0,
    sliderSelector: '',
    derivedFromBookings: true,
  }));
}

/** Whether a linked member is currently selected in saved HTML. */
export function isMemberSelected(html: string, memberId: string): boolean {
  const members = parseLinkedMembers(html);
  return members.find((m) => m.id === memberId)?.selected ?? false;
}

async function readMemberSelection(page: Page, memberId: string): Promise<boolean> {
  return isMemberSelected(await page.content(), memberId);
}

async function waitForMemberSelected(page: Page, member: LinkedMember): Promise<void> {
  const deadline = Date.now() + MEMBER_SWITCH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await readMemberSelection(page, member.id)) return;
    await page.waitForTimeout(MEMBER_SWITCH_POLL_MS);
  }

  const members = parseLinkedMembers(await page.content());
  const known = members.map((m) => `${m.name}${m.selected ? ' (selected)' : ''}`).join(', ');
  throw new EacliCommandError(
    `Failed to switch to member "${member.name}" within ${MEMBER_SWITCH_TIMEOUT_MS / 1000}s. Known members: ${known}`,
    'MEMBER_SWITCH_FAILED'
  );
}

/** Match a linked member by partial name (case-insensitive). */
export function findMemberByName(members: LinkedMember[], nameQuery: string): LinkedMember {
  const q = nameQuery.trim().toLowerCase();
  const match =
    members.find((m) => m.name.toLowerCase() === q) ??
    members.find((m) => m.name.toLowerCase().includes(q)) ??
    members.find((m) => m.name.toLowerCase().split(/\s+/)[0] === q);
  if (!match) {
    throw new Error(`No member matching "${nameQuery}". Known members: ${members.map((m) => m.name).join(', ')}`);
  }
  return match;
}

function memberFromProfile(profile: ResolvedProfile): LinkedMember {
  return {
    name: profile.name,
    id: profile.key,
    selected: true,
    sliderSelector: '',
  };
}

/** Resolve member: explicit name, active login profile, or portal linked member. */
export async function resolveMember(
  page: Page,
  memberName?: string,
  activeProfile?: ResolvedProfile
): Promise<LinkedMember | null> {
  if (activeProfile && hasMultipleProfiles()) {
    if (memberName?.trim()) {
      if (!memberMatchesProfile(memberName, activeProfile.key, activeProfile.name)) {
        throw new EacliCommandError(
          `Member "${memberName}" does not match active profile "${activeProfile.key}" (${activeProfile.name}). Use --profile to switch accounts.`,
          'VALIDATION_ERROR'
        );
      }
    }
    return memberFromProfile(activeProfile);
  }

  const members = await getMembers(page);
  if (members.length === 0) return null;

  const member = memberName?.trim()
    ? findMemberByName(members, memberName)
    : (members.find((m) => m.selected) ?? members[0])!;

  if (!member.selected && !member.derivedFromBookings) {
    await switchMember(page, member);
  }
  return member;
}

export async function switchMember(page: Page, member: LinkedMember): Promise<void> {
  if (member.derivedFromBookings || !member.sliderSelector) {
    if (process.env.DEBUG) {
      console.log(
        chalk.gray(
          `[debug] Member "${member.name}" has no portal switcher (derived from bookings); skipping UI switch`
        )
      );
    }
    return;
  }

  if (!page.url().includes('memberHomePage.aspx')) {
    await safeGoto(page, MEMBER_HOME_URL, { timeout: 20000, label: 'member-home' });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  }

  if (await readMemberSelection(page, member.id)) {
    if (process.env.DEBUG) {
      console.log(chalk.gray(`[debug] Member already selected: ${member.name}`));
    }
    return;
  }

  if (process.env.DEBUG) {
    console.log(chalk.gray(`[debug] Switching to member: ${member.name} (${member.sliderSelector})`));
  }

  await page.locator(member.sliderSelector).click();
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await waitForMemberSelected(page, member);

  await page.locator('#collapseQuickBook').waitFor({ state: 'attached', timeout: 10000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
}

/** Fetch linked members from member home, falling back to Manage Bookings attribution. */
export async function getMembers(page: Page, activeProfile?: ResolvedProfile): Promise<LinkedMember[]> {
  if (activeProfile && hasMultipleProfiles()) {
    return [memberFromProfile(activeProfile)];
  }
  if (!page.url().includes('memberHomePage.aspx') && !page.url().includes('mrmSelectSite.aspx')) {
    await safeGoto(page, MEMBER_HOME_URL, { timeout: 20000, label: 'member-home' });
  }
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await ensureNoErrorPage(page, 'member-home');

  await page.locator('#linkedMembers li').first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});

  let members = parseLinkedMembers(await page.content());

  if (members.length === 0) {
    if (process.env.DEBUG) {
      console.log(chalk.gray('[debug] #linkedMembers empty — deriving members from Manage Bookings'));
    }
    const { collectManageBookingRows } = await import('./cancelBooking.js');
    const rows = await collectManageBookingRows(page);
    members = membersFromBookingRows(rows);
  }

  if (process.env.DEBUG) {
    console.log(chalk.gray(`[debug] Page URL: ${page.url()}`));
    console.log(chalk.gray(`[debug] Found ${members.length} linked member(s)`));
  }

  if (members.length === 0) {
    try {
      fs.mkdirSync('.eacli-session', { recursive: true });
      fs.writeFileSync('.eacli-session/last-members-page.html', await page.content());
      if (process.env.DEBUG) {
        console.log(chalk.gray('[debug] Saved HTML to .eacli-session/last-members-page.html'));
      }
    } catch {}
  }

  return members;
}

export function printProfileSummaries(profiles: ProfileSummary[]): void {
  if (profiles.length === 0) {
    console.log(chalk.yellow('No profiles configured.'));
    return;
  }

  console.log(chalk.gray('(Each profile is a separate Everyone Active login — pass --profile or --member to select.)\n'));
  console.log(chalk.green(`${profiles.length} profile(s):\n`));

  printTable(
    profiles.map((p, idx) => ({
      '#': idx + 1,
      Key: p.key,
      Name: p.name,
      Default: p.default ? 'yes' : 'no',
      Session: p.hasSession ? 'saved' : 'none',
    }))
  );
}

export function printMembers(members: LinkedMember[]): void {
  if (members.length === 0) {
    console.log(chalk.yellow('No linked members found (you may only have a single account).'));
    return;
  }

  const derived = members.some((m) => m.derivedFromBookings);
  if (derived) {
    console.log(chalk.gray('(Members inferred from Manage Bookings — portal home switcher unavailable.)\n'));
  }

  console.log(chalk.green(`${members.length} linked member(s):\n`));

  printTable(
    members.map((m, idx) => ({
      '#': idx + 1,
      Name: m.name,
      ID: m.id,
      Selected: m.selected ? 'yes' : 'no',
    }))
  );
}