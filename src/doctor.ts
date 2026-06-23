import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { chromium } from 'playwright';
import { successResponse, type EacliResponse, writeJson, isJsonMode } from './output.js';
import {
  hasProfilesFile,
  listProfileSummaries,
  loadProfilesConfig,
  profilesConfigPath,
  resolveAuthStatePath,
} from './profiles.js';

export interface DoctorCheck {
  name: string;
  ok: boolean;
  message: string;
}

export interface DoctorResult {
  checks: DoctorCheck[];
  ready: boolean;
}

const LEGACY_AUTH_STATE = '.eacli-auth-state.json';

export async function runDoctor(): Promise<DoctorResult> {
  const checks: DoctorCheck[] = [];

  if (hasProfilesFile()) {
    try {
      const config = loadProfilesConfig();
      const keys = Object.keys(config.profiles);
      checks.push({
        name: 'profiles_file',
        ok: true,
        message: `${profilesConfigPath()} defines ${keys.length} profile(s): ${keys.join(', ')} (default: ${config.default})`,
      });
      for (const summary of listProfileSummaries()) {
        checks.push({
          name: `session_${summary.key}`,
          ok: summary.hasSession,
          message: summary.hasSession
            ? `Session for profile "${summary.key}" (${resolveAuthStatePath(summary.key)})`
            : `No session for profile "${summary.key}" — run: eacli login --profile ${summary.key}`,
        });
      }
    } catch (err: unknown) {
      checks.push({
        name: 'profiles_file',
        ok: false,
        message: `Invalid ${profilesConfigPath()}: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  } else {
    const envPath = path.resolve('.env');
    if (fs.existsSync(envPath)) {
      const envText = fs.readFileSync(envPath, 'utf8');
      const hasUser = /\bUSERNAME\s*=/i.test(envText);
      const hasPass = /\bPASSWORD\s*=/i.test(envText);
      checks.push({
        name: 'env_file',
        ok: hasUser && hasPass,
        message:
          hasUser && hasPass
            ? '.env contains USERNAME and PASSWORD (single default profile)'
            : '.env missing USERNAME or PASSWORD',
      });
    } else {
      checks.push({
        name: 'env_file',
        ok: false,
        message: 'No .env or .eacli-profiles.json — copy .env.example or .eacli-profiles.example.json',
      });
    }

    const sessionPath = fs.existsSync(resolveAuthStatePath('default'))
      ? resolveAuthStatePath('default')
      : LEGACY_AUTH_STATE;
    checks.push({
      name: 'auth_state',
      ok: fs.existsSync(sessionPath),
      message: fs.existsSync(sessionPath)
        ? `Session file ${sessionPath} exists`
        : `No session file — run eacli login once`,
    });
  }

  try {
    const browser = await chromium.launch({ headless: true });
    await browser.close();
    checks.push({
      name: 'playwright',
      ok: true,
      message: 'Playwright Chromium launches successfully',
    });
  } catch (err: unknown) {
    checks.push({
      name: 'playwright',
      ok: false,
      message: `Playwright failed: ${err instanceof Error ? err.message : err}. Run: npx playwright install chromium`,
    });
  }

  const ready = checks.every((c) => c.ok);
  return { checks, ready };
}

export function printDoctor(result: DoctorResult): void {
  console.log(chalk.blue('\neacli doctor\n'));
  for (const check of result.checks) {
    const icon = check.ok ? chalk.green('✓') : chalk.red('✗');
    console.log(`${icon} ${check.name}: ${check.message}`);
  }
  console.log(
    result.ready
      ? chalk.green('\nReady to use eacli.')
      : chalk.yellow('\nFix the issues above before booking.')
  );
}

export function emitDoctorJson(result: DoctorResult): EacliResponse<DoctorResult> {
  return successResponse('doctor', result);
}

export async function doctorCommand(): Promise<void> {
  const result = await runDoctor();
  if (isJsonMode()) {
    writeJson(emitDoctorJson(result));
  } else {
    printDoctor(result);
  }
  if (!result.ready) process.exit(1);
}