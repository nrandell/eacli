import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { clearProfilesConfigCache, type ProfilesConfig } from '../../src/profiles.js';

const TEST_PROFILES_PATH = '.eacli-profiles.test.json';
const ENV_KEY = 'EACLI_PROFILES_FILE';

export function installTestProfilesConfig(config: ProfilesConfig): void {
  writeFileSync(TEST_PROFILES_PATH, JSON.stringify(config, null, 2));
  process.env[ENV_KEY] = TEST_PROFILES_PATH;
  clearProfilesConfigCache();
}

export function resetTestProfilesConfig(): void {
  delete process.env[ENV_KEY];
  clearProfilesConfigCache();
  if (existsSync(TEST_PROFILES_PATH)) unlinkSync(TEST_PROFILES_PATH);
}