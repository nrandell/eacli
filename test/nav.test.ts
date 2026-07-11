import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isRetriableNavError } from '../src/nav.js';
import { mapErrorFromThrowable } from '../src/output.js';
import { bestActivityMatch, normalizeActivityQuery, scoreActivityMatch } from '../src/classStatus.js';

test('isRetriableNavError detects ERR_NETWORK_CHANGED', () => {
  const err = new Error(
    'page.goto: net::ERR_NETWORK_CHANGED at https://book.everyoneactive.com/Connect/mrmSelectSite.aspx'
  );
  assert.equal(isRetriableNavError(err), true);
});

test('isRetriableNavError detects TimeoutError name', () => {
  const err = new Error('Timeout 20000ms exceeded');
  err.name = 'TimeoutError';
  assert.equal(isRetriableNavError(err), true);
});

test('isRetriableNavError rejects activity-not-found', () => {
  assert.equal(isRetriableNavError(new Error('Activity "hiit" not found under Group Exercise')), false);
});

test('mapErrorFromThrowable maps net::ERR_ to NETWORK_ERROR', () => {
  const mapped = mapErrorFromThrowable(
    new Error('page.goto: net::ERR_NETWORK_CHANGED at https://book.everyoneactive.com/Connect/mrmViewMyBookings.aspx')
  );
  assert.equal(mapped.code, 'NETWORK_ERROR');
  assert.match(mapped.message, /retry once/i);
});

test('mapErrorFromThrowable maps empty activity list to ACTIVITY_NOT_FOUND', () => {
  const mapped = mapErrorFromThrowable(
    new Error('Activity list was empty while looking for "h I I t" (page URL: https://example.com)')
  );
  assert.equal(mapped.code, 'ACTIVITY_NOT_FOUND');
});

test('normalizeActivityQuery strips day and time suffixes', () => {
  assert.equal(normalizeActivityQuery('H I I T Sat 08:25'), 'H I I T');
  assert.equal(normalizeActivityQuery('hiit'), 'hiit');
});

test('scoreActivityMatch accepts spaced h I I t query', () => {
  assert.ok(scoreActivityMatch('H I I T Sat 08:25', 'h I I t') > 0);
  assert.equal(
    bestActivityMatch(['H I I T Sat 08:25', 'Combat Thu 19:00'], 'h I I t', new Date(2026, 6, 18)),
    'H I I T Sat 08:25'
  );
});

test('scoreActivityMatch accepts full portal label as query', () => {
  assert.ok(scoreActivityMatch('H I I T Sat 08:25', 'H I I T Sat 08:25') > 0);
});
