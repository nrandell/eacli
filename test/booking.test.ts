import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isAlreadyBookedPageMessage } from '../src/classStatus.js';
import { mapErrorFromThrowable } from '../src/output.js';
import { EacliCommandError } from '../src/output.js';

test('isAlreadyBookedPageMessage detects portal already-booked text', () => {
  assert.equal(
    isAlreadyBookedPageMessage(
      'Sorry, no available activities could be found, or you are already booked into this activity.'
    ),
    true
  );
  assert.equal(isAlreadyBookedPageMessage('No sessions in this window'), false);
  assert.equal(isAlreadyBookedPageMessage(undefined), false);
});

test('mapErrorFromThrowable maps ALREADY_BOOKED from EacliCommandError', () => {
  const err = new EacliCommandError(
    'Nick Randell is already booked into BodyCombat Sun 10:30 on Sun 28 Jun.',
    'ALREADY_BOOKED'
  );
  const mapped = mapErrorFromThrowable(err);
  assert.equal(mapped.code, 'ALREADY_BOOKED');
  assert.match(mapped.message, /already booked/i);
});