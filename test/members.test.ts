import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { findMemberByName, isMemberSelected, parseLinkedMembers } from '../src/members.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(__dirname, 'fixtures');

function loadFixture(name: string): string {
  return readFileSync(join(fixtureDir, name), 'utf8');
}

test('parseLinkedMembers reads selected state from hidden input', () => {
  const members = parseLinkedMembers(loadFixture('linked-members-a-selected.html'));
  assert.equal(members.length, 2);
  assert.equal(members[0]!.name, 'Nick Randell');
  assert.equal(members[0]!.id, '123');
  assert.equal(members[0]!.selected, true);
  assert.equal(members[0]!.sliderSelector, '#SelectedMemberCheckBox-123');
  assert.equal(members[1]!.name, 'Hayley Randell');
  assert.equal(members[1]!.id, '456');
  assert.equal(members[1]!.selected, false);
});

test('isMemberSelected reflects post-switch fixture state', () => {
  const aSelected = loadFixture('linked-members-a-selected.html');
  const bSelected = loadFixture('linked-members-b-selected.html');

  assert.equal(isMemberSelected(aSelected, '123'), true);
  assert.equal(isMemberSelected(aSelected, '456'), false);
  assert.equal(isMemberSelected(bSelected, '123'), false);
  assert.equal(isMemberSelected(bSelected, '456'), true);
});

test('findMemberByName supports exact, partial, and first-name match', () => {
  const members = parseLinkedMembers(loadFixture('linked-members-a-selected.html'));

  assert.equal(findMemberByName(members, 'Nick Randell').id, '123');
  assert.equal(findMemberByName(members, 'nick').id, '123');
  assert.equal(findMemberByName(members, 'Hayley').id, '456');
  assert.equal(findMemberByName(members, 'randell').id, '123');
});

test('findMemberByName throws for unknown member', () => {
  const members = parseLinkedMembers(loadFixture('linked-members-a-selected.html'));
  assert.throws(() => findMemberByName(members, 'Nobody'), /No member matching "Nobody"/);
});
