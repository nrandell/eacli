import type { Page } from 'playwright';
import { getActiveRunLog } from './runLog.js';

export interface SafeGotoOptions {
  timeout?: number;
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit';
  /** Max attempts including the first try. Default 3. */
  attempts?: number;
  /** Short label for run logs (e.g. "manage-bookings"). */
  label?: string;
}

const DEFAULT_ATTEMPTS = 3;
const BACKOFF_MS = [500, 1500, 3000];

/** True when Playwright / Chromium network errors are worth retrying. */
export function isRetriableNavError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : '';

  if (name === 'TimeoutError') return true;

  return (
    /net::ERR_/i.test(message) ||
    /ERR_NETWORK_CHANGED/i.test(message) ||
    /ERR_CONNECTION_/i.test(message) ||
    /ERR_INTERNET_DISCONNECTED/i.test(message) ||
    /ERR_NAME_NOT_RESOLVED/i.test(message) ||
    /ERR_TIMED_OUT/i.test(message) ||
    /ERR_EMPTY_RESPONSE/i.test(message) ||
    /ERR_HTTP2_PROTOCOL_ERROR/i.test(message) ||
    /Navigation failed because page was closed/i.test(message) ||
    /NS_ERROR_NET/i.test(message) ||
    /timeout.*exceeded/i.test(message) ||
    /exceeded.*timeout/i.test(message)
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * page.goto with retries for flaky network (ERR_NETWORK_CHANGED, timeouts, etc.).
 * Always logs attempts to the active run log when one exists.
 */
export async function safeGoto(
  page: Page,
  url: string,
  options: SafeGotoOptions = {}
): Promise<void> {
  const timeout = options.timeout ?? 20000;
  const waitUntil = options.waitUntil ?? 'domcontentloaded';
  const attempts = Math.max(1, options.attempts ?? DEFAULT_ATTEMPTS);
  const label = options.label ?? url;
  const log = getActiveRunLog();

  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      log?.phase(`goto ${label}`, { attempt, url, timeout });
      await page.goto(url, { waitUntil, timeout });
      if (attempt > 1) {
        log?.info(`goto succeeded after retry`, { attempt, label, url });
      }
      return;
    } catch (err: unknown) {
      lastError = err;
      const retriable = isRetriableNavError(err) && attempt < attempts;
      log?.warn(`goto failed`, {
        attempt,
        label,
        url,
        retriable,
        error: err instanceof Error ? err.message : String(err),
      });
      if (!retriable) break;
      const delay = BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)] ?? 3000;
      await sleep(delay);
    }
  }

  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw lastError instanceof Error
    ? lastError
    : new Error(`Navigation failed for ${label}: ${detail}`);
}
