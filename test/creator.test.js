import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readCreator } from '../app/creator.js';
import { hashGame, readLibrary } from '../app/library.js';
import { checkGame } from '../kit/check.js';

const ROOT = path.join(import.meta.dirname, '..'), KIT = path.join(ROOT, 'kit');
const read = (value) => readCreator(Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)));
const sponsor = { name: 'Puzzle Shop', text: 'Wooden puzzles made by hand', url: 'https://puzzles.example.com/a?b=c' };
const copyGame = (t) => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'og-')), 'shikaku');
  fs.cpSync(path.join(ROOT, 'games/shikaku'), dir, { recursive: true });
  t.after(() => fs.rmSync(path.dirname(dir), { recursive: true }));
  return dir;
};

test('a game without the file has no lines', () => assert.deepEqual(readCreator(undefined), { support: null, sponsor: null }));
test('pages where somebody can be supported are allowed', () => {
  for (const url of ['https://github.com/sponsors/some-one', 'https://ko-fi.com/some_one', 'https://buymeacoffee.com/a.b', 'https://www.patreon.com/a', 'https://liberapay.com/a', 'https://opencollective.com/a-b']) assert.equal(read({ support: url }).support, url);
  assert.deepEqual(read({ sponsor }).sponsor, sponsor);
});
test('every other address is refused', () => {
  const bad = ['http://ko-fi.com/a', 'https://evil.example/a', 'https://github.com/a/b', 'https://github.com/sponsors/a/../../x', 'https://ko-fi.com/a?x=1', 'https://ko-fi.com/a#x', 'https://ko-fi.com.evil.example/a',
    'https://ko-fi.com@evil.example/a', 'https://ko-fi.com:8443/a', 'javascript:alert(1)', 'file:///etc/hosts', 'https://KO-FI.com\\@evil.example', 'https://ko-fi.com/', 5, null, ['https://ko-fi.com/a']];
  for (const support of bad) assert.throws(() => read({ support }), /support must/, String(support));
  const urls = ['http://a.example', 'https://127.0.0.1/', 'https://[::1]/', 'https://localhost/', 'https://u:p@a.example/', 'https://a.example:81/', 'https://xn--pple-43d.com/', 'https://\u0430pple.com/', 'ms-settings:x', `https://a.example/${'x'.repeat(200)}`, 'https://a.example/ x', null];
  for (const url of urls) assert.throws(() => read({ sponsor: { ...sponsor, url } }), /sponsor must/, String(url));
});
test('text that hides or turns around is refused, and so is anything unknown', () => {
  for (const text of ['', ' a', 'a\nb', 'a\u202eb', 'a\u200bb', 'x'.repeat(81), 5]) assert.throws(() => read({ sponsor: { ...sponsor, text } }), /sponsor must/, JSON.stringify(text));
  for (const name of ['', 'x'.repeat(41), undefined]) assert.throws(() => read({ sponsor: { ...sponsor, name } }), /sponsor must/);
  for (const v of [[], 'null', '5', { html: 'x' }, { sponsor: { ...sponsor, script: 'x' } }, { sponsor: null }]) assert.throws(() => read(v));
  for (const v of ['{', `{"support":"${'x'.repeat(3000)}"}`]) assert.throws(() => read(v));
});
test('the lines are approved with the game, but players with other lines still meet, and the game never sees them', (t) => {
  const dir = copyGame(t), before = hashGame(dir), [game] = readLibrary(path.dirname(dir), KIT);
  fs.writeFileSync(path.join(dir, 'creator.json'), JSON.stringify({ support: 'https://ko-fi.com/a', sponsor }));
  const [after] = readLibrary(path.dirname(dir), KIT, { shikaku: hashGame(dir) });
  assert.equal(after.hash, game.hash);
  assert.equal(after.support, 'https://ko-fi.com/a');
  assert.equal(after.files.has('creator.json'), false);
  assert.notEqual(hashGame(dir), before);
  t.mock.method(console, 'error', () => {});
  assert.deepEqual(readLibrary(path.dirname(dir), KIT, { shikaku: before }), []);
});
test('bad lines keep a game out of the check and the library', (t) => {
  const dir = copyGame(t);
  fs.writeFileSync(path.join(dir, 'creator.json'), '{"support":"https://evil.example"}');
  assert.throws(() => checkGame(dir), /support must/);
  t.mock.method(console, 'error', () => {});
  assert.deepEqual(readLibrary(path.dirname(dir), KIT), []);
});
