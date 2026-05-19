import type { Page } from 'playwright';
import * as cheerio from 'cheerio';
import { printTable } from 'console-table-printer';
import chalk from 'chalk';
import fs from 'fs';
import { MEMBER_HOME_URL, ensureNoErrorPage } from './connect.js';

export interface LinkedMember {
  name: string;
  id: string;
  selected: boolean;
  sliderSelector: string;
}

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

/** Resolve member: explicit name, or the currently selected linked member, or null if single-account. */
export async function resolveMember(page: Page, memberName?: string): Promise<LinkedMember | null> {
  if (!page.url().includes('memberHomePage.aspx')) {
    await page.goto(MEMBER_HOME_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
  }
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await ensureNoErrorPage(page, 'member-home');

  const members = parseLinkedMembers(await page.content());
  if (members.length === 0) return null;

  const member = memberName?.trim()
    ? findMemberByName(members, memberName)
    : (members.find((m) => m.selected) ?? members[0])!;

  if (!member.selected) await switchMember(page, member);
  return member;
}

export async function switchMember(page: Page, member: LinkedMember): Promise<void> {
  if (process.env.DEBUG) {
    console.log(chalk.gray(`[debug] Switching to member: ${member.name} (${member.sliderSelector})`));
  }
  await page.locator(member.sliderSelector).click();
  await page.waitForTimeout(800);
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
}

/** Fetch linked members from the Connect member home page. */
export async function getMembers(page: Page): Promise<LinkedMember[]> {
  if (!page.url().includes('memberHomePage.aspx')) {
    await page.goto(MEMBER_HOME_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
  }
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await ensureNoErrorPage(page, 'member-home');

  // Member list may render after initial paint / AJAX
  await page.locator('#linkedMembers li').first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});

  const html = await page.content();
  const members = parseLinkedMembers(html);

  if (process.env.DEBUG) {
    console.log(chalk.gray(`[debug] Page URL: ${page.url()}`));
    console.log(chalk.gray(`[debug] Found ${members.length} linked member(s)`));
  }

  if (members.length === 0) {
    const hasPanel = (await page.locator('#linkedMembers').count()) > 0;
    if (!hasPanel && process.env.DEBUG) {
      console.log(chalk.yellow('[debug] #linkedMembers not found on page'));
    }
    try {
      fs.mkdirSync('.eacli-session', { recursive: true });
      fs.writeFileSync('.eacli-session/last-members-page.html', html);
      if (process.env.DEBUG) {
        console.log(chalk.gray('[debug] Saved HTML to .eacli-session/last-members-page.html'));
      }
    } catch {}
  }

  return members;
}

export function printMembers(members: LinkedMember[]): void {
  if (members.length === 0) {
    console.log(chalk.yellow('No linked members found (you may only have a single account).'));
    return;
  }

  console.log(chalk.green(`\n${members.length} linked member(s):\n`));

  printTable(
    members.map((m, idx) => ({
      '#': idx + 1,
      Name: m.name,
      ID: m.id,
      Selected: m.selected ? 'yes' : 'no',
    }))
  );
}
