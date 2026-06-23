import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { bestActivityMatch, parseActivityGroupNames, scoreActivityMatch } from '../src/classStatus.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(__dirname, 'fixtures');
import { membersFromBookingRows } from '../src/members.js';
import type { ManageBookingRow } from '../src/cancelBooking.js';

test('scoreActivityMatch maps hiit query to H I I T activity names', () => {
  const score = scoreActivityMatch('H I I T Tue 18:40', 'hiit');
  assert.ok(score > 0);
});

test('bestActivityMatch prefers day-aligned activities when date is given', () => {
  const activities = ['Vir BodyCombat Thu 13:00', 'BodyCombat Sun 10:30', 'Combat Thu 19:00'];
  const sunday = new Date(2026, 5, 28);
  assert.equal(bestActivityMatch(activities, 'combat', sunday), 'BodyCombat Sun 10:30');
});

test('bestActivityMatch deprioritises virtual classes for in-centre queries', () => {
  const activities = ['Vir BodyCombat Thu 13:00', 'Combat Thu 19:00'];
  assert.equal(bestActivityMatch(activities, 'combat'), 'Combat Thu 19:00');
});

test('bestActivityMatch returns undefined when no activity matches requested day', () => {
  const activities = ['H I I T Sat 08:25', 'H I I T Tue 18:40'];
  const wednesday = new Date(2026, 5, 24);
  assert.equal(bestActivityMatch(activities, 'hiit', wednesday), undefined);
});

test('parseActivityGroupNames lists in-centre and virtual group exercise separately', () => {
  const html = readFileSync(join(fixtureDir, 'activity-groups-alton.html'), 'utf8');
  const groups = parseActivityGroupNames(html);
  assert.deepEqual(groups, ['Group Exercise - Virtual', 'Group Exercise 16+ Yrs']);
});

test('membersFromBookingRows deduplicates household names', () => {
  const rows: ManageBookingRow[] = [
    {
      activity: 'Combat Thu 19:00',
      date: 'Thu 25 Jun',
      time: '19:00',
      site: 'Alton Sports Centre',
      member: 'Nick Randell',
      cancelQaId: 'x',
      status: 'Confirmed',
    },
    {
      activity: 'Combat Thu 19:00',
      date: 'Thu 25 Jun',
      time: '19:00',
      site: 'Alton Sports Centre',
      member: 'Hayley Randell',
      cancelQaId: 'y',
      status: 'Confirmed',
    },
  ];
  const members = membersFromBookingRows(rows);
  assert.deepEqual(
    members.map((m) => m.name),
    ['Hayley Randell', 'Nick Randell']
  );
  assert.equal(members[0]!.derivedFromBookings, true);
});