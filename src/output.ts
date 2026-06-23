export const EACLI_JSON_VERSION = 1;

export type EacliErrorCode =
  | 'NO_SESSION'
  | 'ACTIVITY_NOT_FOUND'
  | 'BOOKING_NOT_FOUND'
  | 'AMBIGUOUS_MEMBER'
  | 'MEMBER_NOT_FOUND'
  | 'MEMBER_SWITCH_FAILED'
  | 'NOT_LOGGED_IN'
  | 'SITE_ERROR'
  | 'NO_SLOTS'
  | 'ALREADY_BOOKED'
  | 'TIMEOUT'
  | 'VALIDATION_ERROR'
  | 'PROFILE_NOT_FOUND'
  | 'PROFILE_MISMATCH'
  | 'AMBIGUOUS_PROFILE'
  | 'UNKNOWN';

export interface EacliError {
  message: string;
  code: EacliErrorCode;
}

export interface EacliResponse<T> {
  version: typeof EACLI_JSON_VERSION;
  ok: boolean;
  command: string;
  data?: T;
  error?: EacliError;
}

export class EacliCommandError extends Error {
  readonly code: EacliErrorCode;

  constructor(message: string, code: EacliErrorCode) {
    super(message);
    this.name = 'EacliCommandError';
    this.code = code;
  }
}

let jsonMode = false;

export function setJsonMode(enabled: boolean): void {
  jsonMode = enabled;
}

export function isJsonMode(): boolean {
  return jsonMode;
}

export function successResponse<T>(command: string, data: T): EacliResponse<T> {
  return { version: EACLI_JSON_VERSION, ok: true, command, data };
}

export function errorResponse(command: string, error: EacliError): EacliResponse<never> {
  return { version: EACLI_JSON_VERSION, ok: false, command, error };
}

export function writeJson<T>(payload: EacliResponse<T>): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

export function logInfo(message: string): void {
  if (jsonMode && !process.env.DEBUG) return;
  console.error(message);
}

export function mapErrorFromThrowable(err: unknown): EacliError {
  if (err instanceof EacliCommandError) {
    return { message: err.message, code: err.code };
  }

  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();

  if (/no session on/i.test(message)) {
    return { message, code: 'NO_SESSION' };
  }
  if (/activity .* not found/i.test(message) || /no group exercise activities match/i.test(message)) {
    return { message, code: 'ACTIVITY_NOT_FOUND' };
  }
  if (/no booking found/i.test(message)) {
    return { message, code: 'BOOKING_NOT_FOUND' };
  }
  if (/multiple bookings match/i.test(message)) {
    return { message, code: 'AMBIGUOUS_MEMBER' };
  }
  if (/member .* not found/i.test(message) || /no member matching/i.test(message)) {
    return { message, code: 'MEMBER_NOT_FOUND' };
  }
  if (
    /login failed/i.test(message) ||
    /not logged in/i.test(message) ||
    /username.*password/i.test(lower)
  ) {
    return { message, code: 'NOT_LOGGED_IN' };
  }
  if (/error page/i.test(message) || /an error has occurred/i.test(lower)) {
    return { message, code: 'SITE_ERROR' };
  }
  if (/already booked into/i.test(message) || /is already booked/i.test(lower)) {
    return { message, code: 'ALREADY_BOOKED' };
  }
  if (/no bookable|no available book|no book or waitlist/i.test(lower)) {
    return { message, code: 'NO_SLOTS' };
  }
  if (/could not parse date/i.test(message)) {
    return { message, code: 'VALIDATION_ERROR' };
  }
  if (/booking basket did not load/i.test(message)) {
    return { message, code: 'TIMEOUT' };
  }
  if (
    err instanceof Error &&
    (err.name === 'TimeoutError' || /timeout.*exceeded/i.test(message) || /waiting for locator/i.test(lower))
  ) {
    return { message, code: 'TIMEOUT' };
  }

  return { message, code: 'UNKNOWN' };
}

export function exitCodeForError(code: EacliErrorCode): number {
  if (code === 'VALIDATION_ERROR') return 2;
  return 1;
}

export async function runCommand<T>(
  command: string,
  fn: () => Promise<T>
): Promise<T> {
  try {
    const data = await fn();
    if (jsonMode) {
      writeJson(successResponse(command, data));
    }
    return data;
  } catch (err: unknown) {
    const error = mapErrorFromThrowable(err);
    if (jsonMode) {
      writeJson(errorResponse(command, error));
    } else {
      console.error(err instanceof Error ? err.message : err);
    }
    process.exit(exitCodeForError(error.code));
  }
}
