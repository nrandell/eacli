import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { findMatchingManageBookingRow, parseManageBookings } from '../src/cancelBooking.js';
import {
  bookingSessionKey,
  groupBookingsBySession,
  type Booking,
} from '../src/bookings.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(__dirname, 'fixtures');

function loadFixture(name: string): string {
  return readFileSync(join(fixtureDir, name), 'utf8');
}

/** Previous list_bookings dedupe: merged household upcoming panel duplicates by session key. */
function legacyDedupeBySession(bookings: Booking[]): Booking[] {
  const seen = new Map<string, Booking>();
  for (const booking of bookings) {
    const key = booking.reference ?? bookingSessionKey(booking.date, booking.time, booking.activity);
    const memberName = booking.member ?? booking.members[0] ?? '';
    const existing = seen.get(key);
    if (existing) {
      if (memberName && !existing.members.includes(memberName)) {
        existing.members.push(memberName);
        const first = existing.members[0] ?? '';
        existing.member = existing.members.length > 1 ? `${first}, ${memberName}` : first;
      }
    } else {
      seen.set(key, {
        ...booking,
        members: memberName ? [memberName] : [...booking.members],
        ...(memberName ? { member: memberName } : {}),
      });
    }
  }
  return [...seen.values()];
}

test('parseManageBookings extracts member per row', () => {
  const rows = parseManageBookings(loadFixture('manage-bookings-multi-member.html'));
  assert.equal(rows.length, 8);
  assert.equal(
    rows.filter(
      (r) => r.activity.replace(/\s/g, '').toUpperCase().includes('HIIT') && r.member === 'Nick Randell'
    ).length,
    3
  );
  assert.equal(rows.filter((r) => r.activity === 'Combat').length, 2);
});

test('groupBookingsBySession matches Nick/Hayley split', () => {
  const rows = parseManageBookings(loadFixture('manage-bookings-multi-member.html'));
  const sessions = groupBookingsBySession(rows);

  assert.equal(sessions.length, 5);

  const hiitTue = sessions.find(
    (s) => s.date === 'Tue 19 May' && s.activity.replace(/\s/g, '').toUpperCase().includes('HIIT')
  );
  assert.deepEqual(hiitTue?.members, ['Nick Randell']);

  const combat = sessions.find((s) => s.date === 'Thu 21 May');
  assert.deepEqual(combat?.members, ['Hayley Randell', 'Nick Randell']);

  const hiitSat = sessions.find((s) => s.date === 'Sat 23 May');
  assert.deepEqual(hiitSat?.members, ['Nick Randell']);

  const bodyCombat = sessions.find((s) => s.date === 'Sun 24 May');
  assert.deepEqual(bodyCombat?.members, ['Hayley Randell', 'Nick Randell']);

  const hiitTue26 = sessions.find((s) => s.date === 'Tue 26 May');
  assert.deepEqual(hiitTue26?.members, ['Hayley Randell', 'Nick Randell']);
});

test('regression: legacy upcoming-panel dedupe falsely marks both on Nick-only HIIT', () => {
  const householdHiit: Booking = {
    date: 'Tue 19 May',
    time: '18:40',
    activity: 'H I I T',
    location: 'Centre',
    status: 'Confirmed',
    reference: '12345',
    members: [],
  };

  const nickPass = { ...householdHiit, members: ['Nick Randell'], member: 'Nick Randell' };
  const hayleyPass = { ...householdHiit, members: ['Hayley Randell'], member: 'Hayley Randell' };
  const legacy = legacyDedupeBySession([nickPass, hayleyPass]);
  assert.equal(legacy.length, 1);
  assert.equal(legacy[0]!.members.length, 2, 'legacy dedupe wrongly merges household panel dupes');

  const rows = parseManageBookings(loadFixture('manage-bookings-multi-member.html'));
  const hiitRows = rows.filter(
    (r) => r.date === 'Tue 19 May' && r.activity.replace(/\s/g, '').toUpperCase().includes('HIIT')
  );
  const grouped = groupBookingsBySession(hiitRows);
  assert.equal(grouped.length, 1);
  assert.deepEqual(grouped[0]!.members, ['Nick Randell']);
});

test('groupBookingsBySession merges correctly when rows arrive across simulated pages (pagination case)', () => {
  // Simulate the collector accumulating page1 (only Nick for a future date) + page2 (Hayley for same session)
  const page1Rows = [
    { activity: 'Combat', date: 'Thu 4 Jun', time: '19:00', site: 'Centre', member: 'Nick Randell', cancelQaId: 'lnkbutton-Cancel-IDX1-Date&Time=04/06/2026', status: 'Confirmed' },
  ];
  const page2Rows = [
    { activity: 'Combat', date: 'Thu 4 Jun', time: '19:00', site: 'Centre', member: 'Hayley Randell', cancelQaId: 'lnkbutton-Cancel-IDX2-Date&Time=04/06/2026', status: 'Confirmed' },
  ];

  // As the collector does: union then group
  const combined = [...page1Rows, ...page2Rows] as any;
  const sessions = groupBookingsBySession(combined);

  const combat = sessions.find((s) => s.date === 'Thu 4 Jun');
  assert.ok(combat, 'session from paged rows must be present');
  assert.deepEqual(combat!.members.sort(), ['Hayley Randell', 'Nick Randell']);
  assert.equal(combat!.member, undefined, 'multi-member session must not emit legacy singular member field');
});

test('parseManageBookings reads all gvBookings tables (waitlist + confirmed)', () => {
  const rows = parseManageBookings(loadFixture('manage-bookings-waitlist-and-confirmed.html'));
  assert.equal(rows.length, 10);

  const waitlist = rows.filter((r) => r.status === 'Waiting List');
  const confirmed = rows.filter((r) => r.status === 'Confirmed');
  assert.equal(waitlist.length, 2);
  assert.equal(confirmed.length, 8);
});

test('groupBookingsBySession groups waitlist + confirmed into five sessions', () => {
  const rows = parseManageBookings(loadFixture('manage-bookings-waitlist-and-confirmed.html'));
  const sessions = groupBookingsBySession(rows);

  assert.equal(sessions.length, 5);

  const combat = sessions.find((s) => s.date === 'Thu 18 Jun');
  assert.ok(combat);
  assert.equal(combat!.status, 'Waiting List');
  assert.deepEqual(combat!.members.sort(), ['Hayley Randell', 'Nick Randell']);

  const hiitSat13 = sessions.find((s) => s.date === 'Sat 13 Jun');
  assert.ok(hiitSat13);
  assert.equal(hiitSat13!.status, 'Confirmed');
  assert.deepEqual(hiitSat13!.members.sort(), ['Hayley Randell', 'Nick Randell']);
});

test('findMatchingManageBookingRow locates confirmed HIIT when waitlist table is present', () => {
  const rows = parseManageBookings(loadFixture('manage-bookings-waitlist-and-confirmed.html'));
  const row = findMatchingManageBookingRow(rows, {
    activity: 'hiit',
    date: 'saturday',
    memberName: 'Nick Randell',
  });

  assert.equal(row.date, 'Sat 13 Jun');
  assert.equal(row.member, 'Nick Randell');
  assert.equal(row.status, 'Confirmed');
});
