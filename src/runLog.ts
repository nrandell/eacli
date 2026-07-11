import fs from 'fs';
import path from 'path';
import type { Page } from 'playwright';

export const SESSION_DIR = '.eacli-session';
export const LOGS_DIR = path.join(SESSION_DIR, 'logs');
export const LAST_RUN_LOG = path.join(SESSION_DIR, 'last-run.log');
export const LAST_FAILURE_HTML = path.join(SESSION_DIR, 'last-failure.html');
export const LAST_FAILURE_PNG = path.join(SESSION_DIR, 'last-failure.png');

export interface RunLogMeta {
  command: string;
  profile?: string | undefined;
  args?: Record<string, unknown> | undefined;
}

export interface FailureArtifacts {
  htmlPath?: string;
  pngPath?: string;
  url?: string;
  title?: string;
}

let activeRunLog: RunLog | undefined;

function ensureDirs(): void {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

function isoStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function redactArgs(args?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!args) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (/password|passwd|secret|token/i.test(k)) {
      out[k] = '[redacted]';
    } else {
      out[k] = v;
    }
  }
  return out;
}

function formatLine(level: string, message: string, extra?: Record<string, unknown>): string {
  const ts = new Date().toISOString();
  const extraStr =
    extra && Object.keys(extra).length > 0 ? ` ${JSON.stringify(extra)}` : '';
  return `${ts} [${level}] ${message}${extraStr}\n`;
}

export class RunLog {
  readonly logPath: string;
  readonly command: string;
  readonly startedAt: string;
  private profile: string | undefined;
  private artifacts: string[] = [];

  constructor(meta: RunLogMeta) {
    ensureDirs();
    this.command = meta.command;
    this.startedAt = new Date().toISOString();
    this.profile = meta.profile ?? undefined;
    const safeCmd = meta.command.replace(/[^a-z0-9._-]+/gi, '_');
    const safeProfile = (meta.profile || 'default').replace(/[^a-z0-9._-]+/gi, '_');
    this.logPath = path.join(LOGS_DIR, `${isoStamp()}-${safeCmd}-${safeProfile}.log`);

    this.writeRaw(
      formatLine('INFO', 'run start', {
        command: meta.command,
        profile: meta.profile,
        args: redactArgs(meta.args),
        cwd: process.cwd(),
        pid: process.pid,
      })
    );
    this.syncLastRunPointer();
  }

  get relativeLogPath(): string {
    return this.logPath;
  }

  get artifactList(): string[] {
    return [...this.artifacts];
  }

  setProfile(profile: string): void {
    this.profile = profile;
    this.info('profile resolved', { profile });
  }

  phase(name: string, extra?: Record<string, unknown>): void {
    this.writeRaw(formatLine('PHASE', name, extra));
    // Always emit milestones on stderr so OpenClaw exec/poll sees progress
    // even when stdout is reserved for JSON.
    try {
      const suffix = extra && Object.keys(extra).length ? ` ${JSON.stringify(extra)}` : '';
      process.stderr.write(`[eacli] ${name}${suffix}\n`);
    } catch {
      /* ignore broken pipe */
    }
  }

  info(message: string, extra?: Record<string, unknown>): void {
    this.writeRaw(formatLine('INFO', message, extra));
    if (process.env.DEBUG) {
      try {
        process.stderr.write(`[eacli:debug] ${message}${extra ? ` ${JSON.stringify(extra)}` : ''}\n`);
      } catch {
        /* ignore */
      }
    }
  }

  warn(message: string, extra?: Record<string, unknown>): void {
    this.writeRaw(formatLine('WARN', message, extra));
  }

  error(message: string, extra?: Record<string, unknown>): void {
    this.writeRaw(formatLine('ERROR', message, extra));
  }

  async captureFailure(page: Page | undefined, context: string): Promise<FailureArtifacts> {
    const result: FailureArtifacts = {};
    ensureDirs();

    if (!page) {
      this.error('failure capture skipped (no page)', { context });
      return result;
    }

    try {
      result.url = page.url();
    } catch {
      /* page may be closed */
    }
    try {
      result.title = await page.title();
    } catch {
      /* ignore */
    }

    try {
      const html = await page.content();
      fs.writeFileSync(LAST_FAILURE_HTML, html);
      result.htmlPath = LAST_FAILURE_HTML;
      this.artifacts.push(LAST_FAILURE_HTML);
    } catch (err: unknown) {
      this.warn('could not save failure HTML', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    try {
      await page.screenshot({ path: LAST_FAILURE_PNG, fullPage: true });
      result.pngPath = LAST_FAILURE_PNG;
      this.artifacts.push(LAST_FAILURE_PNG);
    } catch (err: unknown) {
      this.warn('could not save failure screenshot', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    this.error('failure captured', {
      context,
      url: result.url,
      title: result.title,
      htmlPath: result.htmlPath,
      pngPath: result.pngPath,
    });

    return result;
  }

  finishSuccess(extra?: Record<string, unknown>): void {
    this.writeRaw(
      formatLine('INFO', 'run success', {
        command: this.command,
        profile: this.profile,
        ...extra,
      })
    );
    this.syncLastRunPointer();
  }

  finishError(err: unknown, artifacts?: FailureArtifacts): void {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    this.writeRaw(
      formatLine('ERROR', 'run failed', {
        command: this.command,
        profile: this.profile,
        message,
        stack,
        url: artifacts?.url,
        title: artifacts?.title,
        htmlPath: artifacts?.htmlPath,
        pngPath: artifacts?.pngPath,
      })
    );
    this.syncLastRunPointer();
  }

  private writeRaw(line: string): void {
    try {
      fs.appendFileSync(this.logPath, line);
    } catch {
      /* best-effort */
    }
  }

  private syncLastRunPointer(): void {
    try {
      const header =
        `# eacli last run pointer\n` +
        `# command: ${this.command}\n` +
        `# profile: ${this.profile ?? ''}\n` +
        `# started: ${this.startedAt}\n` +
        `# log: ${this.logPath}\n` +
        `# ---\n`;
      const body = fs.existsSync(this.logPath) ? fs.readFileSync(this.logPath, 'utf8') : '';
      fs.writeFileSync(LAST_RUN_LOG, header + body);
    } catch {
      /* best-effort */
    }
  }
}

export function startRunLog(meta: RunLogMeta): RunLog {
  const log = new RunLog(meta);
  activeRunLog = log;
  return log;
}

export function getActiveRunLog(): RunLog | undefined {
  return activeRunLog;
}

export function endRunLog(): void {
  activeRunLog = undefined;
}

/** Best-effort snapshot of diagnostic files for doctor / agents. */
export function getDiagnosticsSummary(): {
  lastRunLog?: string;
  lastFailureHtml?: string;
  lastFailurePng?: string;
  lastRunLogMtime?: string;
  lastFailureHtmlMtime?: string;
  playwrightVersion?: string;
} {
  const out: ReturnType<typeof getDiagnosticsSummary> = {};
  try {
    if (fs.existsSync(LAST_RUN_LOG)) {
      out.lastRunLog = LAST_RUN_LOG;
      out.lastRunLogMtime = fs.statSync(LAST_RUN_LOG).mtime.toISOString();
    }
    if (fs.existsSync(LAST_FAILURE_HTML)) {
      out.lastFailureHtml = LAST_FAILURE_HTML;
      out.lastFailureHtmlMtime = fs.statSync(LAST_FAILURE_HTML).mtime.toISOString();
    }
    if (fs.existsSync(LAST_FAILURE_PNG)) {
      out.lastFailurePng = LAST_FAILURE_PNG;
    }
  } catch {
    /* ignore */
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'node_modules/playwright/package.json'), 'utf8')
    ) as { version?: string };
    if (pkg.version) out.playwrightVersion = pkg.version;
  } catch {
    /* ignore */
  }
  return out;
}
