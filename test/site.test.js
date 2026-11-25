import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readLibrary } from '../app/library.js';
import { meet } from '../app/shell/wire.js';
import { startMatchServer } from '../server/match-server.js';
import { createSite, escape } from '../server/site.js';
import { createStats } from '../server/stats.js';
import { createLeaderboard } from '../server/leaderboard.js';
import { until } from './helpers.js';

const ROOT = path.join(import.meta.dirname, '..');
const games = readLibrary(path.join(ROOT, 'games'), path.join(ROOT, 'kit'));
const keyOf = (id) => { const g = games.find((x) => x.id === id); return `${g.id}@${g.hash}`; };
const DAY = 24 * 60 * 60 * 1000, NOW = Date.UTC(2026, 10, 25, 12);
const stats = (extra = {}) => createStats({ file: ':memory:', library: games, clock: () => NOW, ...extra });
const today = (s, id = 'shikaku') => s.of(id).days.at(-1).matches;

test('a match between two addresses is counted for its game and day', () => {
  const s = stats();
  assert.equal(s.played(keyOf('shikaku'), ['1.1.1.1', '2.2.2.2']), true);
  assert.equal(today(s), 1);
  assert.equal(today(s, 'gemhold'), 0);
  assert.deepEqual([s.of('shikaku').total, s.of('shikaku').days.length, s.of('shikaku').days.at(-1).day], [1, 30, '2026-11-25']);
});
test('one address, other versions and unknown games are not counted', () => {
  const s = stats();
  assert.equal(s.played(keyOf('shikaku'), ['1.1.1.1', '1.1.1.1']), false);
  assert.equal(s.played(`shikaku@${'a'.repeat(64)}`, ['1.1.1.1', '2.2.2.2']), false);
  assert.equal(s.played('nothing', ['1.1.1.1', '2.2.2.2']), false);
  assert.equal(s.of('shikaku').total, 0);
});
test('one address can only add a few matches a day to a game', () => {
  let now = NOW;
  const s = stats({ clock: () => now, limits: { perAddressPerDay: 2 } });
  const add = (other) => s.played(keyOf('shikaku'), ['1.1.1.1', other]);
  assert.deepEqual(['2', '3', '4'].map(add), [true, true, false]);
  assert.equal(s.played(keyOf('gemhold'), ['1.1.1.1', '4']), true);
  now += DAY;
  assert.equal(add('4'), true);
});
test('a large IPv6 network is one address', () => {
  const s = stats();
  assert.equal(s.played(keyOf('shikaku'), ['2001:db8:1:1', '2001:db8:1:2']), false);
  assert.equal(s.played(keyOf('shikaku'), ['2001:db8:1:1', '2001:db8:2:1']), true);
});
test('the memory for addresses is limited', () => {
  const s = stats({ limits: { addresses: 2 } });
  assert.deepEqual([s.played(keyOf('shikaku'), ['1', '2']), s.played(keyOf('shikaku'), ['3', '4'])], [true, false]);
});
test('days before counting began are unknown, not zero, and the start is remembered', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opengames-stats-')), file = path.join(dir, 'stats.db');
  const first = stats({ file });
  first.played(keyOf('shikaku'), ['1', '2']);
  first.close();
  const later = stats({ file, clock: () => NOW + 2 * DAY });
  assert.equal(later.since, '2026-11-25');
  assert.deepEqual(later.of('shikaku').days.slice(-4).map((d) => d.matches), [null, 1, 0, 0]);
  later.close();
  fs.rmSync(dir, { recursive: true });
});
test('nothing about players is stored', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opengames-stats-')), s = stats({ file: path.join(dir, 'stats.db') });
  s.played(keyOf('shikaku'), ['203.0.113.77', '198.51.100.88']);
  s.close();
  for (const f of fs.readdirSync(dir)) assert.doesNotMatch(fs.readFileSync(path.join(dir, f), 'latin1'), /203\.0\.113|198\.51\.100/);
  fs.rmSync(dir, { recursive: true });
});

async function playFor(playedMs, waitMs, addresses = ['10.0.0.1', '10.0.0.2']) {
  const counted = [];
  const s = await startMatchServer({ proxies: 1, limits: { playedMs }, stats: { played: (...x) => counted.push(x) } });
  const { WebSocket: Socket } = await import('ws');
  const join = (ask, ip) => {
    const c = {};
    Object.assign(c, meet({ url: `ws://127.0.0.1:${s.port}`, key: keyOf('shikaku'), ask, Socket: class extends Socket { constructor(url) { super(url, { headers: { 'x-forwarded-for': ip } }); } }, on: { code: (m) => { c.code = m.code; }, paired: (m) => { c.paired = m; } } }));
    return c;
  };
  const a = join({ t: 'create' }, addresses[0]);
  await until(() => a.code);
  const b = join({ t: 'join', code: a.code }, addresses[1]);
  await until(() => a.paired && b.paired);
  await new Promise((r) => { setTimeout(r, waitMs); });
  b.paired.close();
  await new Promise((r) => { setTimeout(r, 120); });
  a.paired.close();
  await s.close();
  return counted;
}
test('the match server counts a match that lasts, once', async () => {
  assert.deepEqual(await playFor(30, 90), [[keyOf('shikaku'), ['10.0.0.1', '10.0.0.2']]]);
});
test('a match somebody leaves at once is not counted', async () => {
  assert.deepEqual(await playFor(100, 5), []);
});

const evil = { ...games[0], author: 'A & "B" <script>', name: '<img src=x>', summary: '"><b>', support: 'https://ko-fi.com/ann', sponsor: { name: '<i>Shop</i>', text: "it's", url: 'https://shop.example/?a=1&b=2' } };
const bodyOf = (site, p) => site(p).body.toString();
test('every page is there, and nothing else is', () => {
  const site = createSite({ games, stats: stats(), ranked: () => 3 });
  for (const p of ['/', '/creators', '/site.css', '/icon.svg', '/creators/DansiDanutz', ...games.flatMap((g) => [`/games/${g.id}`, `/games/${g.id}/icon`])]) assert.equal(site(p).status, 200, p);
  for (const p of ['/games/nothing', '/games/nothing/icon', '/creators/nobody', '/creators/%', '/creators/__proto__']) assert.equal(site(p).status, 404, p);
  for (const p of ['/leaderboard', '/result', '/health', '/games', '/games/shikaku/rules.js', '/games/../package.json']) assert.equal(site(p), null, p);
});
test('names from a game cannot become markup', () => {
  const site = createSite({ games: [evil], stats: stats(), ranked: () => 0 });
  for (const p of ['/', '/creators', `/games/${evil.id}`, `/creators/${encodeURIComponent(evil.author)}`]) {
    const body = bodyOf(site, p);
    assert.equal(site(p).status, 200, p);
    assert.doesNotMatch(body, /<script|<img src=x|<i>Shop|"><b>/, p);
  }
  assert.equal(escape(`<&>"'`), '&#60;&#38;&#62;&#34;&#39;');
});
test('pages run no scripts, and an icon opened alone is locked up', () => {
  const site = createSite({ games, stats: stats() });
  const page = site('/').headers['content-security-policy'], icon = site(`/games/${games[0].id}/icon`).headers['content-security-policy'];
  assert.match(page, /default-src 'none'/);
  assert.doesNotMatch(page, /script-src|unsafe/);
  assert.match(icon, /sandbox/);
});
test('a dashboard shows the matches of its creator only', () => {
  const s = stats();
  const other = { ...games[1], author: 'Ann' };
  s.played(keyOf('shikaku'), ['1', '2']);
  const site = createSite({ games: [games.find((g) => g.id === 'shikaku'), other], stats: s, ranked: () => 1 });
  const mine = bodyOf(site, '/creators/DansiDanutz'), theirs = bodyOf(site, '/creators/Ann');
  assert.match(mine, /25 Nov: 1 match</);
  assert.match(mine, /1 ranked player</);
  assert.doesNotMatch(theirs, /Shikaku/);
  assert.match(theirs, /25 Nov: 0 matches</);
  assert.match(theirs, /Counted since 25 Nov 2026/);
});
test('support and sponsor links say what they are', () => {
  const body = bodyOf(createSite({ games: [evil] }), `/games/${evil.id}`);
  assert.match(body, /href="https:\/\/ko-fi\.com\/ann" rel="noopener noreferrer nofollow"/);
  assert.match(body, /rel="noopener noreferrer nofollow sponsored"/);
  assert.match(body, /Sponsor, paid to the creator/);
});
test('without statistics the pages still work', () => {
  assert.match(bodyOf(createSite({ games }), '/creators/DansiDanutz'), /does not count matches/);
});
test('the server serves the pages beside the leaderboards, within its limits', async () => {
  const leaderboard = createLeaderboard({ file: ':memory:', library: games.map((g) => ({ ...g, rulesPath: path.join(g.dir, g.rules) })) });
  const s = await startMatchServer({ leaderboard, site: createSite({ games, stats: stats(), ranked: leaderboard.players }), limits: { pagesPerMinute: 3 } });
  const get = (p, init) => fetch(`http://127.0.0.1:${s.port}${p}`, init);
  const page = await get('/creators/DansiDanutz');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /^text\/html/);
  assert.match(await page.text(), /0 ranked players/);
  assert.deepEqual(await (await get('/leaderboard?game=shikaku')).json(), { players: [] });
  assert.equal((await get('/', { method: 'POST' })).status, 404);
  assert.deepEqual(await (await get('/health')).json(), { ok: true });
  assert.equal((await get('/site.css')).status, 200);
  assert.equal((await get('/')).status, 200);
  assert.equal((await get('/')).status, 429);
  await s.close();
  leaderboard.close();
});
