import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

test('RunLog writes log file and last-run pointer under cwd', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eacli-runlog-'));
  const prev = process.cwd();
  try {
    process.chdir(tmp);
    // Dynamic import after chdir so SESSION_DIR resolves relative to tmp
    const { RunLog, LAST_RUN_LOG, LOGS_DIR } = await import('../src/runLog.js');
    const log = new RunLog({ command: 'doctor', profile: 'nick', args: { password: 'secret' } });
    log.phase('test-phase');
    log.finishSuccess();

    assert.ok(fs.existsSync(log.logPath), 'per-run log exists');
    assert.ok(fs.existsSync(LAST_RUN_LOG), 'last-run.log exists');
    assert.ok(fs.existsSync(LOGS_DIR), 'logs dir exists');

    const body = fs.readFileSync(log.logPath, 'utf8');
    assert.match(body, /run start/);
    assert.match(body, /test-phase/);
    assert.match(body, /run success/);
    assert.match(body, /\[redacted\]/);
    assert.doesNotMatch(body, /secret/);
  } finally {
    process.chdir(prev);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
