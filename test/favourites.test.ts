import assert from 'node:assert/strict';
import { test } from 'node:test';
import { favouritesFromBookingRows, parseSessionDateLabel, resolveTargetDate } from '../src/favourites.js';
import type { ManageBookingRow } from '../src/cancelBooking.js';

test('resolveTargetDate parses next sunday as upcoming Sunday', () => {
  const d = resolveTargetDate('next sunday');
  assert.equal(d.getDay(), 0);
});

test('parseSessionDateLabel keeps recent same-year booking dates', () => {
  const d = parseSessionDateLabel('Sat 13 Jun, 08:25');
  assert.ok(d);
  assert.equal(d!.getMonth(), 5);
  assert.equal(d!.getDate(), 13);
});

test('resolveTargetDate parses ISO and UK dates', () => {
  const iso = resolveTargetDate('2026-06-28');
  assert.equal(iso.getFullYear(), 2026);
  assert.equal(iso.getMonth(), 5);
  assert.equal(iso.getDate(), 28);

  const uk = resolveTargetDate('28/06/2026');
  assert.equal(uk.getDate(), 28);
  assert.equal(uk.getMonth(), 5);
});

test('favouritesFromBookingRows deduplicates activity names', () => {
  const rows: ManageBookingRow[] = [
    {
      activity: 'Combat Thu 19:00',
      date: 'Thu 25 Jun',
      time: '19:00',
      site: 'Alton',
      member: 'Nick Randell',
      cancelQaId: 'x',
      status: 'Confirmed',
    },
    {
      activity: 'Combat Thu 19:00',
      date: 'Thu 25 Jun',
      time: '19:00',
      site: 'Alton',
      member: 'Hayley Randell',
      cancelQaId: 'y',
      status: 'Confirmed',
    },
    {
      activity: 'BodyCombat Sun 10:30',
      date: 'Sun 28 Jun',
      time: '10:30',
      site: 'Alton',
      member: 'Nick Randell',
      cancelQaId: 'z',
      status: 'Confirmed',
    },
  ];
  const favs = favouritesFromBookingRows(rows);
  assert.deepEqual(favs.map((f) => f.name), ['Combat Thu 19:00', 'BodyCombat Sun 10:30']);
});