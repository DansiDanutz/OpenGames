/* Real app windows on a real match server, for the window tests. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { _electron } from 'playwright-core';
import { startMatchServer } from '../server/match-server.js';
import { createLeaderboard } from '../server/leaderboard.js';
import { readLibrary } from '../app/library.js';

const executablePath = createRequire(import.meta.url)('electron');
const ROOT = path.join(import.meta.dirname, '..');
const SHOTS = process.env.SHOTS;
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'opengames-test-'));
const library = readLibrary(path.join(ROOT, 'games'), path.join(ROOT, 'kit')).map(({ id, hash, options, dir, rules }) => ({ id, hash, options, rulesPath: path.join(dir, rules) }));
export const leaderboard = createLeaderboard({ file: ':memory:', library });
export const server = await startMatchServer({ leaderboard, limits: { rankSameAddress: true } });
export const apps = [];

export async function open(who) {
  const app = await _electron.launch({ executablePath, args: [ROOT], env: { ...process.env, OPENGAMES_QUIET: '1',
    OPENGAMES_SERVER: `ws://127.0.0.1:${server.port}`, OPENGAMES_DATA: path.join(data, who) } });
  apps.push(app);
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.waitForSelector('#games li');
  await page.fill('#name', who);
  await page.press('#name', 'Enter');
  return { app, page, who, errors };
}
/* Runs code inside the game's own page. */
export const inGame = (p, code) => p.app.evaluate(async ({ webContents }, js) => {
  const game = webContents.getAllWebContents().find((c) => c.getURL().startsWith('og-game://'));
  return game ? game.executeJavaScript(js) : null;
}, code);
export const status = (p, re) => p.page.waitForFunction((source) => new RegExp(source).test(document.getElementById('status').textContent), re.source, { timeout: 15000, polling: 100 }).catch(async (error) => {
  const now = await Promise.all(apps.map(async (a) => (await a.firstWindow()).evaluate(() => [document.body.dataset.screen, document.getElementById('status').textContent, document.getElementById('waitTitle').textContent, document.getElementById('mode').textContent, document.getElementById('notice').textContent].join(' | '))));
  throw new Error(`${p.who} waited for ${re}. Windows: ${JSON.stringify(now)}`, { cause: error });
});
export const shot = async (p, name) => {
  if (!SHOTS) return;
  const png = await p.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'));
  fs.writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(png, 'base64'));
  const game = await p.app.evaluate(async ({ webContents }) => {
    const c = webContents.getAllWebContents().find((x) => x.getURL().startsWith('og-game://'));
    return c ? (await c.capturePage()).toPNG().toString('base64') : null;
  });
  if (game) fs.writeFileSync(path.join(SHOTS, `${name}-game.png`), Buffer.from(game, 'base64'));
};
/* One game's row in the library. */
export const row = (p, game) => p.page.locator('#games li').filter({ has: p.page.locator(`img[src="/icons/${game}"]`) });
/* Chooses the rules in a game's room. */
export async function choose(p, { options = {}, rounds = 1 } = {}) {
  await p.page.waitForSelector('#room:not([hidden])');
  await p.page.evaluate(() => { document.getElementById('roomRules').open = true; });
  for (const [id, value] of Object.entries(options)) await p.page.locator(`input[name="option-${id}"][value="${value}"]`).check();
  await p.page.locator(`input[name="rounds"][value="${rounds}"]`).check();
  await shot(p, 'room');
}
/* Into a game's room, and from there somewhere. */
export async function enter(p, game, rules) {
  await row(p, game).getByText('Play', { exact: true }).click();
  await choose(p, rules);
}
export async function join(p, game, code) {
  await row(p, game).getByText('Play', { exact: true }).click();
  await p.page.waitForSelector('#room:not([hidden])');
  await p.page.fill('#joinCode', code);
  await p.page.click('#joinForm button');
}
/* The other player reads the rules and accepts them. */
export async function accept(p, pattern) {
  await p.page.waitForSelector('#terms:not([hidden])');
  if (pattern) assert.match(await p.page.textContent('#termsList'), pattern);
  await shot(p, 'terms');
  await p.page.click('#termsYes');
}
export async function invite(a, b, game = 'shikaku', rules = {}) {
  await enter(a, game, rules);
  await a.page.waitForSelector('#share:not([hidden])');
  const code = await a.page.textContent('#code');
  await shot(a, 'invite');
  await join(b, game, code);
  await accept(b, rules.expect);
  await Promise.all([a, b].map((p) => status(p, /^Playing$/)));
}
export async function closeAll() {
  await Promise.all(apps.map((a) => a.close().catch(() => {})));
  await server.close().catch(() => {});
  leaderboard.close();
  fs.rmSync(data, { recursive: true, force: true });
}
