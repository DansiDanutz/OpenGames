import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { readLibrary } from '../app/library.js';
import { createPlay, gamePage, joinPages, swap } from '../server/play.js';

const ROOT = path.join(import.meta.dirname, '..');
const games = readLibrary(path.join(ROOT, 'games'), path.join(ROOT, 'kit'));
const play = createPlay({ games, stunPort: 3478 });
const policy = (p, host = 'play.example.org') => play(p, { host }).headers['content-security-policy'];

test('the app, the kit and every game are there, and nothing else is', () => {
  for (const p of ['/play', '/app/shell/shell.js', '/app/invite.js', '/kit/ui.js', '/web/desk.js', '/web/icon-192.png', ...games.flatMap((g) => [`/icons/${g.id}`, `/table/${g.id}/${g.page}`, `/table/${g.id}/${g.rules}`])]) assert.equal(play(p).status, 200, p);
  for (const p of ['/app/main.js', '/app/shell/../main.js', '/server/main.js', '/package.json', '/kit/check.js', '/table/shikaku/', '/table/shikaku/../gemhold/rules.js', '/table/shikaku/creator.json', '/web/', '/__proto__', '/leaderboard']) assert.equal(play(p), null, p);
});
test('the list of games has what the app needs and no files', () => {
  const list = JSON.parse(play('/web/games.json').body);
  assert.equal(list.stunPort, 3478);
  assert.deepEqual(list.games.map((g) => [g.id, g.hash]), games.map((g) => [g.id, g.hash]));
  for (const g of list.games) assert.deepEqual([g.files, g.dir], [undefined, undefined]);
});
test('a game is locked up: no origin, no network, no frames', () => {
  for (const g of games) {
    const csp = policy(`/table/${g.id}/${g.page}`);
    for (const rule of ['sandbox allow-scripts;', "connect-src 'none'", "frame-src 'none'", "worker-src 'none'", "form-action 'none'", "frame-ancestors 'self'"]) assert.ok(csp.includes(rule), rule);
    assert.doesNotMatch(csp, /allow-same-origin|unsafe-eval/);
    assert.ok(play(`/table/${g.id}/${g.page}`).body.toString().indexOf('/web/game.js') < play(`/table/${g.id}/${g.page}`).body.toString().indexOf('page.js'));
  }
});
test('the app page runs its own scripts only and cannot be framed', () => {
  assert.match(policy('/play'), /script-src 'self';/);
  assert.match(policy('/play'), /frame-ancestors 'none'/);
  assert.match(policy('/play'), /connect-src 'self' wss:\/\/play\.example\.org/);
});
test('a strange host name adds nothing to the rules', () => {
  for (const host of ["evil.example; script-src *", '*', 'a b', '']) assert.match(policy('/play', host), /connect-src 'self';/);
});
test('answers are compressed, and not sent twice', () => {
  const first = play('/kit/three.js', { 'accept-encoding': 'gzip, br' });
  assert.equal(first.headers['content-encoding'], 'gzip');
  assert.deepEqual(gunzipSync(first.body), play('/kit/three.js').body);
  const again = play('/kit/three.js', { 'if-none-match': first.headers.etag });
  assert.deepEqual([again.status, again.body], [304, '']);
});
test('what locks a game runs before anything of the game, however its page is written', () => {
  for (const html of ['<!DOCTYPE html>\n<HTML><HEAD lang=en><script src=x.js></script>', '<script src=x.js></script>', '']) {
    const page = gamePage(Buffer.from(html));
    assert.match(page, /^(<!doctype html>)?<script src="\/web\/game\.js"><\/script>/i);
    assert.ok(page.endsWith(html.replace(/^<!doctype html>/i, '')));
  }
});
test('it can be installed on a phone', () => {
  const m = JSON.parse(play('/web/manifest.json').body);
  assert.deepEqual([m.display, m.start_url, m.icons.map((i) => i.sizes)], ['standalone', '/play', ['192x192', '512x512']]);
  for (const i of m.icons) assert.equal(play(i.src).status, 200);
});
test('sets of pages are joined, and a missing piece stops the start', () => {
  const pages = joinPages(Object.assign(() => 'a', { has: (p) => p === '/a' }), Object.assign(() => 'b', { has: (p) => p === '/b' }));
  assert.deepEqual([pages('/a'), pages('/b'), pages('/c'), pages.has('/b'), pages.has('/c')], ['a', 'b', null, true, false]);
  assert.throws(() => swap('abab', 'a', ''), /expected once/);
});
