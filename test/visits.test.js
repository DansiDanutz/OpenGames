import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readLibrary } from '../app/library.js';
import { startMatchServer } from '../server/match-server.js';
import { joinPages } from '../server/play.js';
import { createSite } from '../server/site.js';
import { counted, createStats } from '../server/stats.js';

const ROOT = path.join(import.meta.dirname, '..');
const games = readLibrary(path.join(ROOT, 'games'), path.join(ROOT, 'kit'));
const DAY = 24 * 60 * 60 * 1000, NOW = Date.UTC(2026, 10, 25, 12);
const stats = (extra = {}) => createStats({ file: ':memory:', library: games, clock: () => NOW, ...extra });

test('a visit is one number per page and day', () => {
  let now = NOW;
  const s = stats({ clock: () => now });
  for (const p of ['/', '/', '/play', '/games/shikaku']) assert.equal(s.visited(p), true, p);
  now += DAY;
  s.visited('/');
  const { days, pages } = s.visits();
  assert.equal(days.length, 30);
  assert.deepEqual(days.slice(-2), [{ day: '2026-11-25', total: 4 }, { day: '2026-11-26', total: 1 }]);
  assert.deepEqual(pages, [
    { page: '/', today: 1, week: 3, month: 3 },
    { page: '/games/shikaku', today: 0, week: 1, month: 1 },
    { page: '/play', today: 0, week: 1, month: 1 },
  ]);
});
test('only the public pages are counted', () => {
  const s = stats();
  for (const p of ['/site.css', '/games/shikaku/icon', '/account', '/creators/Ann', '/web/desk.js', '/x'.repeat(30), 'play']) assert.equal(s.visited(p), false, p);
  assert.equal(s.visited('/creators'), true);
  assert.deepEqual(s.visits().pages.map((x) => x.page), ['/creators']);
});
test('visits keep nothing about the visitor', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opengames-visits-')), s = stats({ file: path.join(dir, 'stats.db') });
  s.visited('/');
  s.close();
  const db = fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), 'latin1')).join('');
  assert.match(db, /CREATE TABLE visits \(page TEXT, day TEXT, n INTEGER/);
  assert.doesNotMatch(db, /address|agent|cookie|127\.0\.0\.1/i);
  fs.rmSync(dir, { recursive: true });
});
test('a set of pages counts what it served, and not what it could not find', () => {
  const seen = [];
  const pages = counted(createSite({ games }), { visited: (p) => { seen.push(p); return true; } });
  assert.equal(pages('/').status, 200);
  assert.equal(pages('/games/nothing').status, 404);
  assert.equal(pages('/site.css').status, 200);
  assert.equal(pages('/leaderboard'), null);
  assert.equal(pages.has('/'), true);
  assert.deepEqual(seen, ['/', '/site.css']);
});
test('a failing count never stops a page', () => {
  const pages = counted(createSite({ games }), { visited: () => { throw new Error('disk full'); } });
  assert.equal(pages('/').status, 200);
});
test('the server counts each page it shows', async () => {
  const s = stats(), site = counted(joinPages(createSite({ games, stats: s })), s);
  const server = await startMatchServer({ site });
  const get = (p) => fetch(`http://127.0.0.1:${server.port}${p}`);
  for (const p of ['/', '/', '/games/shikaku', '/games/nothing', '/site.css']) await (await get(p)).text();
  await server.close();
  assert.deepEqual(s.visits().pages, [{ page: '/', today: 2, week: 2, month: 2 }, { page: '/games/shikaku', today: 1, week: 1, month: 1 }]);
});
