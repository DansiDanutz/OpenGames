/* The packed app: node test/packed.e2e.js <path to the program>. Checks that it plays only approved
   games, uses only its built-in server, and cannot be turned into a plain Node or a debugged one. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const program = process.argv[2], data = fs.mkdtempSync(path.join(os.tmpdir(), 'opengames-packed-'));
const asNode = spawnSync(program, ['-e', 'console.log("NODE")'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', OPENGAMES_QUIET: '1', OPENGAMES_DATA: path.join(data, 'n') }, timeout: 6000, encoding: 'utf8' });
assert.ok(!/NODE/.test(asNode.stdout), 'it cannot run as plain Node');
const app = spawn(program, ['--remote-debugging-port=0', '--inspect=0'], { env: { ...process.env, OPENGAMES_QUIET: '1', OPENGAMES_DATA: path.join(data, 'a'), OPENGAMES_SERVER: 'ws://127.0.0.1:1' } });
try {
  let log = '';
  const port = await new Promise((resolve, reject) => {
    app.stderr.on('data', (d) => { log += d; const m = /DevTools listening on (ws:\S+)/.exec(log); if (m) resolve(m[1]); });
    setTimeout(() => reject(new Error(`no window: ${log}`)), 20000);
  });
  assert.ok(!/Debugger listening/.test(log), 'the main program cannot be debugged');
  const browser = await chromium.connectOverCDP(port), page = browser.contexts()[0].pages()[0];
  await page.waitForSelector('#games li');
  assert.deepEqual(await page.locator('#games h3').allTextContents(), ['Avioane & Bărcuțe', 'Gemhold', 'Shikaku']);
  const { server, stun } = await page.evaluate(() => desk.games());
  assert.match(server, /^wss:\/\//);
  console.log('PACKED OK', JSON.stringify({ server, stun }));
  await browser.close();
} finally {
  app.kill();
  await new Promise((r) => { app.once('exit', r); setTimeout(r, 4000); });
  fs.rmSync(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
