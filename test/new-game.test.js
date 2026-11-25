import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { newGame } from '../tools/new-game.js';
import { checkGame } from '../kit/check.js';
import { readManifest } from '../app/library.js';
import * as starter from '../tools/starter/rules.js';

const folder = (t) => { const games = fs.mkdtempSync(path.join(os.tmpdir(), 'og-new-')); t.after(() => fs.rmSync(games, { recursive: true })); return games; };
const ok = { id: 'frog-race', name: 'Frogs & Ponds', author: 'some-one' };

test('a new game passes the check before anything was changed', (t) => {
  const dir = newGame({ ...ok, games: folder(t) });
  assert.equal(checkGame(dir).matches, 12);
  const m = readManifest(dir);
  assert.deepEqual([m.id, m.name, m.author, m.license], ['frog-race', 'Frogs & Ponds', 'some-one', 'MIT']);
  assert.match(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), /<title>Frogs &amp; Ponds<\/title>/);
  assert.match(fs.readFileSync(path.join(dir, 'LICENSE'), 'utf8'), /some-one/);
});
test('a game that is already there is not replaced', (t) => {
  const games = folder(t), dir = newGame({ ...ok, games });
  fs.writeFileSync(path.join(dir, 'mine.txt'), 'x');
  assert.throws(() => newGame({ ...ok, games }), /already there/);
  assert.ok(fs.existsSync(path.join(dir, 'mine.txt')));
});
test('a game cannot be made outside its folder or with code in its name', (t) => {
  const games = folder(t);
  for (const id of ['../out', 'A', '', 'a/b', '-x', undefined]) assert.throws(() => newGame({ ...ok, id, games }), /the id must/);
  for (const name of ['<script>', '', 'x'.repeat(41), '"x"', undefined]) assert.throws(() => newGame({ ...ok, name, games }), /the name must/);
  for (const author of ['a b', '-a', 'a--b', '', undefined]) assert.throws(() => newGame({ ...ok, author, games }), /GitHub name/);
  assert.deepEqual(fs.readdirSync(games), []);
});
test('the starter refuses moves that are not allowed', () => {
  const s = starter.setup({ options: { size: '5' } });
  assert.throws(() => starter.move(s, 1, { cell: 0 }), /turn/);
  for (const m of [null, {}, { cell: -1 }, { cell: 25 }, { cell: 1.5 }, { cell: '0' }]) assert.throws(() => starter.move(s, 0, m), /not on the board/);
  const next = starter.move(starter.move(s, 0, { cell: 0 }), 1, { cell: 24 });
  for (const cell of [0, 1, 5, 24]) assert.throws(() => starter.move(next, 0, { cell }), /may not claim/);
  assert.equal(starter.bot(next, 1, () => 0), null);
});
