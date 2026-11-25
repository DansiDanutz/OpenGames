/* Two players on one computer: a match server and two app windows. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { startMatchServer } from '../server/match-server.js';

const electron = createRequire(import.meta.url)('electron');
const server = await startMatchServer();
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'opengames-demo-'));
const windows = ['one', 'two'].map((who) => spawn(electron, [path.join(import.meta.dirname, '..')], { stdio: 'inherit',
  env: { ...process.env, OPENGAMES_SERVER: `ws://127.0.0.1:${server.port}`, OPENGAMES_DATA: path.join(data, who) } }));
const stop = async () => {
  windows.forEach((w) => w.kill());
  await server.close();
  fs.rmSync(data, { recursive: true, force: true });
  process.exit();
};
process.on('SIGINT', stop);
Promise.all(windows.map((w) => new Promise((r) => { w.on('exit', r); }))).then(stop);
