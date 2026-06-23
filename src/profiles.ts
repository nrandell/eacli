import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync } from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { EacliCommandError } from './output.js';

dotenv.config({ quiet: true });

/** Config file path (override in tests via `EACLI_PROFILES_FILE`). */
function profilesFilePath(): string {
  return process.env.EACLI_PROFILES_FILE?.trim() || '.eacli-profiles.json';
}
const SESSION_DIR = '.eacli-session';
const LEGACY_AUTH_STATE_FILE = '.eacli-auth-state.json';

export interface ProfileCredentials {
  username: string;
  password: string;
  /** Portal display name — used for --member matching and post-login verification. */
  name: string;
  /** Skip portal name check after login (default: verify). */
  verifyLogin?: boolean;
}

export interface ProfilesConfig {
  default: string;
  profiles: Record<string, ProfileCredentials>;
}

export interface ResolvedProfile extends ProfileCredentials {
  key: string;
}

export interface ProfileSummary {
  key: string;
  name: string;
  hasSession: boolean;
  default: boolean;
}

export interface ResolveProfileOptions {
  profile?: string;
  member?: string;
  /** When true, refuse to fall back to default if multiple profiles exist. */
  requireExplicit?: boolean;
}

let cachedConfig: ProfilesConfig | null | undefined;

function normalizeQuery(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * Strict member → profile matching: profile key, full display name, or first name only.
 * Surnames alone (e.g. "randell") do not match — avoids ambiguous household resolution.
 */
export function memberMatchesProfile(memberQuery: string, profileKey: string, displayName: string): boolean {
  const q = normalizeQuery(memberQuery);
  const key = normalizeQuery(profileKey);
  const name = normalizeQuery(displayName);
  if (!q) return false;
  if (q === key) return true;
  if (q === name) return true;
  const firstName = name.split(/\s+/)[0];
  return Boolean(firstName && q === firstName);
}

/** Portal post-login check: portal label must contain the profile display name or first name. */
export function portalNameMatchesProfile(portalName: string, profile: ResolvedProfile): boolean {
  if (profile.verifyLogin === false) return true;
  const portal = normalizeQuery(portalName);
  const name = normalizeQuery(profile.name);
  const key = normalizeQuery(profile.key);
  if (portal.includes(name)) return true;
  const first = name.split(/\s+/)[0];
  if (first && portal.includes(first)) return true;
  if (portal === key) return true;
  return false;
}

export function sanitizeProfileKey(key: string): string {
  return key.replace(/[^a-z0-9_-]/gi, '_');
}

export function profileAuthStatePath(profileKey: string): string {
  return path.join(SESSION_DIR, `auth-${sanitizeProfileKey(profileKey)}.json`);
}

export function legacyAuthStatePath(): string {
  return LEGACY_AUTH_STATE_FILE;
}

/** Remove legacy single-file session after a profile-specific session is in use. */
export function removeLegacyAuthStateIfPresent(): void {
  if (existsSync(LEGACY_AUTH_STATE_FILE)) {
    try {
      unlinkSync(LEGACY_AUTH_STATE_FILE);
    } catch {}
  }
}

/** Resolve readable auth state path, migrating legacy default session if needed. */
export function resolveAuthStatePath(profileKey: string): string {
  const profilePath = profileAuthStatePath(profileKey);
  if (profileKey === 'default' && !existsSync(profilePath) && existsSync(LEGACY_AUTH_STATE_FILE)) {
    try {
      mkdirSync(SESSION_DIR, { recursive: true });
      copyFileSync(LEGACY_AUTH_STATE_FILE, profilePath);
      removeLegacyAuthStateIfPresent();
      return profilePath;
    } catch {
      return LEGACY_AUTH_STATE_FILE;
    }
  }
  return profilePath;
}

export function profilesConfigPath(): string {
  return profilesFilePath();
}

export function hasProfilesFile(): boolean {
  return existsSync(profilesFilePath());
}

export function loadProfilesConfig(): ProfilesConfig {
  if (cachedConfig) return cachedConfig;

  const configPath = profilesFilePath();
  if (existsSync(configPath)) {
    const raw = readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw) as ProfilesConfig;
    if (!parsed.default?.trim()) {
      throw new EacliCommandError('`.eacli-profiles.json` must set `default` to a profile key', 'VALIDATION_ERROR');
    }
    if (!parsed.profiles || Object.keys(parsed.profiles).length === 0) {
      throw new EacliCommandError('`.eacli-profiles.json` must define at least one profile', 'VALIDATION_ERROR');
    }
    if (!parsed.profiles[parsed.default]) {
      throw new EacliCommandError(
        `Default profile "${parsed.default}" is not defined in .eacli-profiles.json`,
        'VALIDATION_ERROR'
      );
    }
    for (const [key, creds] of Object.entries(parsed.profiles)) {
      if (!creds.username?.trim() || !creds.password) {
        throw new EacliCommandError(`Profile "${key}" is missing username or password`, 'VALIDATION_ERROR');
      }
      if (!creds.name?.trim()) {
        throw new EacliCommandError(`Profile "${key}" is missing name (portal display name)`, 'VALIDATION_ERROR');
      }
    }
    cachedConfig = parsed;
    return parsed;
  }

  const username = process.env.USERNAME?.trim();
  const password = process.env.PASSWORD;
  if (!username || !password) {
    throw new EacliCommandError(
      'No .eacli-profiles.json and USERNAME/PASSWORD not set in .env',
      'VALIDATION_ERROR'
    );
  }

  cachedConfig = {
    default: 'default',
    profiles: {
      default: {
        username,
        password,
        name: username,
      },
    },
  };
  return cachedConfig;
}

/** Clear cached config (e.g. after editing `.eacli-profiles.json` — restart MCP or call before next command). */
export function clearProfilesConfigCache(): void {
  cachedConfig = undefined;
}

export function profileCount(): number {
  return Object.keys(loadProfilesConfig().profiles).length;
}

export function hasMultipleProfiles(): boolean {
  return profileCount() > 1;
}

function matchProfilesByMember(config: ProfilesConfig, member: string): string[] {
  const matches: string[] = [];
  for (const [key, creds] of Object.entries(config.profiles)) {
    if (memberMatchesProfile(member, key, creds.name)) {
      matches.push(key);
    }
  }
  return matches;
}

/** Resolve which profile key (and credentials) to use for this command. */
export function resolveProfile(options: ResolveProfileOptions = {}): ResolvedProfile {
  const config = loadProfilesConfig();
  const keys = Object.keys(config.profiles);

  if (options.profile?.trim()) {
    const key = options.profile.trim();
    const creds = config.profiles[key];
    if (!creds) {
      throw new EacliCommandError(
        `No profile "${key}". Configured: ${keys.join(', ')}`,
        'PROFILE_NOT_FOUND'
      );
    }
    return { key, ...creds };
  }

  if (options.member?.trim()) {
    const matches = matchProfilesByMember(config, options.member);
    if (matches.length === 1) {
      const key = matches[0]!;
      return { key, ...config.profiles[key]! };
    }
    if (matches.length > 1) {
      throw new EacliCommandError(
        `Member "${options.member}" matches multiple profiles: ${matches.join(', ')}. Pass --profile explicitly.`,
        'AMBIGUOUS_PROFILE'
      );
    }
    if (hasProfilesFile()) {
      throw new EacliCommandError(
        `No profile matches member "${options.member}". Configured: ${keys.join(', ')}`,
        'PROFILE_NOT_FOUND'
      );
    }
  }

  if (options.requireExplicit && keys.length > 1) {
    throw new EacliCommandError(
      `Multiple profiles configured (${keys.join(', ')}). Pass --profile or --member.`,
      'VALIDATION_ERROR'
    );
  }

  const key = config.default;
  return { key, ...config.profiles[key]! };
}

export function listProfileSummaries(): ProfileSummary[] {
  const config = loadProfilesConfig();
  return Object.entries(config.profiles).map(([key, creds]) => ({
    key,
    name: creds.name,
    hasSession: existsSync(resolveAuthStatePath(key)),
    default: key === config.default,
  }));
}