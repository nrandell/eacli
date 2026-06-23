import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { parseManageBookings } from '../src/cancelBooking.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(__dirname, 'fixtures');

function loadFixture(name: string): string {
  return readFileSync(join(fixtureDir, name), 'utf8');
}

test('parseManageBookings marks enabled cancel links as cancellable', () => {
  const rows = parseManageBookings(loadFixture('manage-bookings-waitlist-and-confirmed.html'));
  const cancellable = rows.filter((r) => r.cancellable);
  assert.ok(cancellable.length > 0);
  assert.equal(cancellable.some((r) => r.status === 'Waiting List'), true);
});

test('parseManageBookings marks disabled cancel icons as not cancellable', () => {
  const html = `
    <table id="ctl00_MainContent_rptMain_ctl01_gvBookings">
      <caption><h4>Confirmed bookings</h4></caption>
      <tr>
        <td>Combat Thu 19:00</td><td>Thu 25 Jun</td><td>19:00</td><td>Alton</td><td>Paid</td><td>Nick</td>
        <td><a class="aspNetDisabled" title="This booking cannot be cancelled"
          data-qa-id="lnkbutton-Cancel-ID123 Date&amp;Time=25/06/2026">Cancel</a></td>
      </tr>
    </table>`;
  const rows = parseManageBookings(html);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.cancellable, false);
});