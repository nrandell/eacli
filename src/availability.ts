import type { Page } from 'playwright';
import { printTable } from 'console-table-printer';
import chalk from 'chalk';
import fs from 'fs';
import {
  fetchSessionsViaBrowse,
  listGroupExerciseActivities,
  openClassStatus,
  parseClassStatusSessions,
  type ClassSession,
  type SessionStatus,
} from './classStatus.js';
import {
  formatEaDateLabel,
  parseSessionDateLabel,
  resolveTargetDate,
  sameCalendarDay,
} from './favourites.js';
import { isJsonMode } from './output.js';
import { resolveMember, type LinkedMember } from './members.js';

export interface ListAvailabilityOptions {
  memberName?: string;
  activity?: string;
  /** Optional: only show sessions on this day (e.g. saturday, 2026-05-24). */
  date?: string;
}

export interface AvailabilityGroup {
  activityLabel: string;
  member?: string;
  source: 'favourite' | 'browse';
  pageMessage?: string;
  sessions: ClassSession[];
}

export interface ListAvailabilityResult {
  groups: AvailabilityGroup[];
  scannedActivities?: number;
}

function filterByDate(sessions: ClassSession[], dateInput?: string): ClassSession[] {
  if (!dateInput?.trim()) return sessions;
  const target = resolveTargetDate(dateInput);
  return sessions.filter((s) => {
    const d = parseSessionDateLabel(s.when);
    return d ? sameCalendarDay(d, target) : s.when.toLowerCase().includes(formatEaDateLabel(target).toLowerCase());
  });
}

function statusLabel(status: SessionStatus): string {
  switch (status) {
    case 'available':
      return 'Available';
    case 'waitlist':
      return 'Waitlist';
    case 'full':
      return 'Full';
    default:
      return 'Unknown';
  }
}

function normalizeActivity(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '');
}

function matchesActivityQuery(name: string, query: string): boolean {
  const q = normalizeActivity(query);
  const n = normalizeActivity(name);
  return n.includes(q) || q.includes(n);
}

async function listOneActivity(
  page: Page,
  member: LinkedMember | null,
  activity: string,
  date?: string
): Promise<AvailabilityGroup> {
  const opened = await openClassStatus(page, {
    ...(member?.name ? { memberName: member.name } : {}),
    activity,
    ...(date?.trim() ? { date } : {}),
  });
  const html = await page.content();
  const sessions = filterByDate(parseClassStatusSessions(html), date);
  return {
    activityLabel: opened.activityLabel,
    ...(member ? { member: member.name } : {}),
    source: opened.source,
    sessions,
    ...(opened.pageMessage ? { pageMessage: opened.pageMessage } : {}),
  };
}

/** Scan every Group Exercise activity from Make a Booking. */
async function listAllBrowseActivities(
  page: Page,
  member: LinkedMember | null,
  date?: string,
  activityFilter?: string
): Promise<{ groups: AvailabilityGroup[]; scanned: number }> {
  let activityNames = await listGroupExerciseActivities(page);
  if (activityFilter?.trim()) {
    activityNames = activityNames.filter((n) => matchesActivityQuery(n, activityFilter.trim()));
    if (activityNames.length === 0) {
      throw new Error(`No Group Exercise activities match "${activityFilter}".`);
    }
  }

  if (activityNames.length === 0) {
    throw new Error('No Group Exercise activities found under Make a Booking.');
  }

  const groups: AvailabilityGroup[] = [];
  const total = activityNames.length;
  const showProgress = total > 3 && !process.env.DEBUG && !isJsonMode();

  for (let i = 0; i < activityNames.length; i++) {
    const name = activityNames[i]!;
    if (showProgress) {
      process.stdout.write(`\r${chalk.blue(`Checking ${i + 1}/${total}: ${name.slice(0, 40)}…`)}`);
    } else if (process.env.DEBUG) {
      console.log(chalk.gray(`[debug] Checking ${i + 1}/${total}: ${name}`));
    }

    try {
      const { activityLabel, sessions: rawSessions, pageMessage } = await fetchSessionsViaBrowse(page, name);
      const sessions = filterByDate(rawSessions, date);
      groups.push({
        activityLabel,
        ...(member ? { member: member.name } : {}),
        source: 'browse',
        sessions,
        ...(pageMessage ? { pageMessage } : {}),
      });
    } catch (err) {
      if (process.env.DEBUG) {
        console.log(chalk.gray(`[debug] Skipped ${name}:`, err instanceof Error ? err.message : err));
      }
    }
  }

  if (showProgress) process.stdout.write('\r' + ' '.repeat(60) + '\r');

  if (groups.length === 0) {
    throw new Error(`Could not load availability for any of ${total} Group Exercise activities.`);
  }

  return { groups, scanned: total };
}

/** List bookable / waitlist slots. Without --activity, scans all Group Exercise classes. */
export async function listAvailability(page: Page, options: ListAvailabilityOptions): Promise<ListAvailabilityResult> {
  const member = await resolveMember(page, options.memberName);

  let groups: AvailabilityGroup[];
  let scannedActivities: number | undefined;

  if (options.activity?.trim()) {
    const group = await listOneActivity(page, member, options.activity.trim(), options.date);
    groups = [group];
  } else {
    const all = await listAllBrowseActivities(page, member, options.date);
    groups = all.groups;
    scannedActivities = all.scanned;
  }

  if (process.env.DEBUG) {
    const total = groups.reduce((n, g) => n + g.sessions.length, 0);
    console.log(chalk.gray(`[debug] ${groups.length} activit(ies), ${total} session(s) total`));
    try {
      fs.mkdirSync('.eacli-session', { recursive: true });
      fs.writeFileSync('.eacli-session/last-availability.html', await page.content());
    } catch {}
  }

  return {
    groups,
    ...(scannedActivities !== undefined ? { scannedActivities } : {}),
  };
}

export function printAvailability(result: ListAvailabilityResult): void {
  const { groups, scannedActivities } = result;
  const withSessions = groups.filter((g) => g.sessions.length > 0);
  const withoutSessions = groups.filter((g) => g.sessions.length === 0);

  if (scannedActivities !== undefined && scannedActivities > 1) {
    const bookableActivities = withSessions.filter((g) =>
      g.sessions.some((s) => s.status === 'available' || s.status === 'waitlist')
    ).length;
    console.log(
      chalk.gray(
        `Scanned ${scannedActivities} Group Exercise activities; ${bookableActivities} with bookable or waitlist slots.\n`
      )
    );
  }

  if (withSessions.length === 0 && withoutSessions.length === 0) {
    console.log(chalk.yellow('No availability found.'));
    return;
  }

  if (withSessions.length === 0) {
    console.log(chalk.yellow('No bookable or waitlist slots found.'));
    for (const g of withoutSessions) {
      const who = g.member ? `${g.member} · ` : '';
      const msg = g.pageMessage ?? 'No sessions';
      console.log(chalk.gray(`  ${who}${g.activityLabel}: ${msg}`));
    }
    return;
  }

  const showMember = groups.some((g) => g.member !== undefined);
  const multiActivity = withSessions.length > 1;

  for (const group of withSessions) {
    if (multiActivity) {
      const who = showMember && group.member ? `${group.member} · ` : '';
      console.log(chalk.green(`\n${who}${group.activityLabel} (${group.sessions.length} session(s)):`));
    } else {
      const who = showMember && group.member ? ` for ${group.member}` : '';
      console.log(chalk.green(`\n${group.sessions.length} session(s) for ${group.activityLabel}${who}:\n`));
    }

    printTable(
      group.sessions.map((s, idx) => ({
        '#': idx + 1,
        When: s.when,
        Status: statusLabel(s.status),
        Detail: s.detail,
        Duration: s.duration ?? '-',
      }))
    );
  }

  if (withoutSessions.length > 0 && (process.env.DEBUG || withoutSessions.length <= 8)) {
    console.log(chalk.gray('\nNo sessions in window:'));
    for (const g of withoutSessions) {
      const who = g.member ? `${g.member} · ` : '';
      const msg = g.pageMessage ?? 'No sessions in search window';
      console.log(chalk.gray(`  ${who}${g.activityLabel}: ${msg}`));
    }
  } else if (withoutSessions.length > 8) {
    console.log(chalk.gray(`\n${withoutSessions.length} other activities had no sessions in this window.`));
  }

  const bookable = withSessions.reduce(
    (n, g) => n + g.sessions.filter((s) => s.status === 'available' || s.status === 'waitlist').length,
    0
  );
  if (bookable > 0) {
    console.log(
      chalk.gray(
        `\n${bookable} slot(s) can be booked or waitlisted. Use: book --member <name> --activity <name> --date <day>`
      )
    );
  }
}
