// Starts the compiled API with plain `node` (no tsx) and checks it serves the
// health endpoint and the app shell. Catches ESM/CommonJS import problems that
// tsx and vitest hide. Run after `npm run build`.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const port = 3199;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lensiq-smoke-'));
const child = spawn(process.execPath, ['api/dist/index.js'], {
  env: { ...process.env, NODE_ENV: 'development', NOTION_TOKEN: 'smoke-test', PORT: String(port), DATA_DIR: dataDir, LOG_LEVEL: 'warn' },
  stdio: ['ignore', 'inherit', 'inherit'],
});

let exited = false;
child.on('exit', () => (exited = true));

async function check() {
  for (let i = 0; i < 50 && !exited; i++) {
    try {
      const health = await fetch(`http://127.0.0.1:${port}/api/health`);
      const shell = await fetch(`http://127.0.0.1:${port}/`);
      const html = await shell.text();
      if (health.ok && shell.ok && html.includes('<div id="root">')) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

const ok = await check();
child.kill();
fs.rmSync(dataDir, { recursive: true, force: true });
console.log(ok ? 'Smoke test passed: built server starts and serves the app.' : 'Smoke test FAILED: built server did not start.');
process.exit(ok ? 0 : 1);
