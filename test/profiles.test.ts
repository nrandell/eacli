import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, afterEach } from 'node:test';
import { EacliCommandError } from '../src/output.js';
import {
  clearProfilesConfigCache,
  memberMatchesProfile,
  portalNameMatchesProfile,
  profileAuthStatePath,
  removeLegacyAuthStateIfPresent,
  resolveAuthStatePath,
  resolveProfile,
  sanitizeProfileKey,
  type ProfilesConfig,
} from '../src/profiles.js';
import { installTestProfilesConfig, resetTestProfilesConfig } from './helpers/profiles-config.js';

const sampleConfig: ProfilesConfig = {
  default: 'nick',
  profiles: {
    nick: { username: 'nick@example.com', password: 'secret', name: 'Nick Randell' },
    hayley: { username: 'hayley@example.com', password: 'secret', name: 'Hayley Randell' },
  },
};

afterEach(() => {
  resetTestProfilesConfig();
});

test('sanitizeProfileKey keeps safe characters', () => {
  assert.equal(sanitizeProfileKey('nick'), 'nick');
  assert.equal(sanitizeProfileKey('hayley randell'), 'hayley_randell');
});

test('profileAuthStatePath uses sanitized key', () => {
  assert.equal(profileAuthStatePath('hayley'), '.eacli-session/auth-hayley.json');
});

test('memberMatchesProfile accepts key, full name, and first name only', () => {
  assert.equal(memberMatchesProfile('nick', 'nick', 'Nick Randell'), true);
  assert.equal(memberMatchesProfile('Nick Randell', 'nick', 'Nick Randell'), true);
  assert.equal(memberMatchesProfile('hayley', 'hayley', 'Hayley Randell'), true);
  assert.equal(memberMatchesProfile('randell', 'nick', 'Nick Randell'), false);
  assert.equal(memberMatchesProfile('randell', 'hayley', 'Hayley Randell'), false);
});

test('resolveProfile uses explicit profile key', () => {
  installTestProfilesConfig(sampleConfig);
  const resolved = resolveProfile({ profile: 'hayley' });
  assert.equal(resolved.key, 'hayley');
  assert.equal(resolved.name, 'Hayley Randell');
});

test('resolveProfile matches member first name to profile', () => {
  installTestProfilesConfig(sampleConfig);
  assert.equal(resolveProfile({ member: 'hayley' }).key, 'hayley');
  assert.equal(resolveProfile({ member: 'nick' }).key, 'nick');
});

test('resolveProfile falls back to default', () => {
  installTestProfilesConfig(sampleConfig);
  const resolved = resolveProfile();
  assert.equal(resolved.key, 'nick');
});

test('resolveProfile requires explicit when multiple profiles and requireExplicit', () => {
  installTestProfilesConfig(sampleConfig);
  assert.throws(
    () => resolveProfile({ requireExplicit: true }),
    (err: unknown) => err instanceof EacliCommandError && err.code === 'VALIDATION_ERROR'
  );
});

test('resolveProfile throws AMBIGUOUS_PROFILE for shared first name', () => {
  installTestProfilesConfig({
    default: 'a',
    profiles: {
      a: { username: 'a', password: 'p', name: 'Alex Randell' },
      b: { username: 'b', password: 'p', name: 'Alex Smith' },
    },
  });
  assert.throws(
    () => resolveProfile({ member: 'alex' }),
    (err: unknown) => err instanceof EacliCommandError && err.code === 'AMBIGUOUS_PROFILE'
  );
});

test('resolveProfile throws PROFILE_NOT_FOUND for shared surname only', () => {
  installTestProfilesConfig(sampleConfig);
  assert.throws(
    () => resolveProfile({ member: 'randell' }),
    (err: unknown) => err instanceof EacliCommandError && err.code === 'PROFILE_NOT_FOUND'
  );
});

test('portalNameMatchesProfile requires profile name in portal label', () => {
  const profile = { key: 'nick', username: 'n', password: 'p', name: 'Nick Randell' };
  assert.equal(portalNameMatchesProfile('Nick Randell', profile), true);
  assert.equal(portalNameMatchesProfile('Welcome, Nick Randell', profile), true);
  assert.equal(portalNameMatchesProfile('Nick', profile), true);
  assert.equal(portalNameMatchesProfile('Hayley Randell', profile), false);
  assert.equal(portalNameMatchesProfile('Randell', profile), false);
});

test('portalNameMatchesProfile skips check when verifyLogin is false', () => {
  const profile = {
    key: 'nick',
    username: 'n',
    password: 'p',
    name: 'Nick Randell',
    verifyLogin: false,
  };
  assert.equal(portalNameMatchesProfile('Someone Else', profile), true);
});

test('resolveAuthStatePath migrates legacy session and removes legacy file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'eacli-auth-migrate-'));
  const legacy = join(dir, 'legacy-auth.json');
  const profilePath = join(dir, '.eacli-session', 'auth-default.json');
  writeFileSync(legacy, '{"cookies":[]}');

  const prevCwd = process.cwd();
  process.chdir(dir);
  process.env.EACLI_PROFILES_FILE = join(dir, 'profiles.json');
  writeFileSync(process.env.EACLI_PROFILES_FILE, JSON.stringify(sampleConfig));
  clearProfilesConfigCache();

  try {
    mkdirSync('.eacli-session', { recursive: true });
    copyFileSync(legacy, '.eacli-auth-state.json');

    const resolved = resolveAuthStatePath('default');
    assert.equal(resolved, '.eacli-session/auth-default.json');
    assert.equal(existsSync(profilePath), true);
    assert.equal(existsSync('.eacli-auth-state.json'), false);
  } finally {
    process.chdir(prevCwd);
    delete process.env.EACLI_PROFILES_FILE;
    clearProfilesConfigCache();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('removeLegacyAuthStateIfPresent deletes legacy auth file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'eacli-auth-rm-'));
  const prevCwd = process.cwd();
  process.chdir(dir);
  writeFileSync('.eacli-auth-state.json', '{}');
  try {
    removeLegacyAuthStateIfPresent();
    assert.equal(existsSync('.eacli-auth-state.json'), false);
  } finally {
    process.chdir(prevCwd);
    rmSync(dir, { recursive: true, force: true });
  }
});