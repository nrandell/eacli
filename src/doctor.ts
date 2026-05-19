import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { chromium } from 'playwright';
import { successResponse, type EacliResponse, writeJson, isJsonMode } from './output.js';

export interface DoctorCheck {
  name: string;
  ok: boolean;
  message: string;
}

export interface DoctorResult {
  checks: DoctorCheck[];
  ready: boolean;
}

const AUTH_STATE = '.eacli-auth-state.json';

export async function runDoctor(): Promise<DoctorResult> {
  const checks: DoctorCheck[] = [];

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
          ? '.env contains USERNAME and PASSWORD'
          : '.env missing USERNAME or PASSWORD',
    });
  } else {
    checks.push({
      name: 'env_file',
      ok: false,
      message: 'No .env file found (create one with USERNAME and PASSWORD)',
    });
  }

  checks.push({
    name: 'auth_state',
    ok: fs.existsSync(AUTH_STATE),
    message: fs.existsSync(AUTH_STATE)
      ? `Session file ${AUTH_STATE} exists`
      : `No ${AUTH_STATE} — run eacli login once`,
  });

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
