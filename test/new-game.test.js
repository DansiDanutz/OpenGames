import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { newGame } from '../tools/new-game.js';
import { checkAll } from '../tools/check-all.js';
import { checkGame } from '../kit/check.js';
import { readManifest } from '../app/library.js';
import { createRandom } from '../kit/engine.js';
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
  const s = { n: 5, cells: Array(25).fill(-1).with(12, starter.ROCK), turn: 0 };
  assert.throws(() => starter.move(s, 1, { cell: 0 }), /turn/);
  for (const m of [null, {}, { cell: -1 }, { cell: 25 }, { cell: 1.5 }, { cell: '0' }]) assert.throws(() => starter.move(s, 0, m), /not on the board/);
  const next = starter.move(starter.move(s, 0, { cell: 0 }), 1, { cell: 24 });
  for (const cell of [0, 1, 5, 12, 24]) assert.throws(() => starter.move(next, 0, { cell }), /may not claim/);
  assert.equal(starter.bot(next, 1, () => 0), null);
});
test('the check sees every folder, and refuses a link, a loose file and a folder with another name', (t) => {
  const quiet = [t.mock.method(console, 'log', () => {}), t.mock.method(console, 'error', () => {})];
  const games = folder(t), dir = newGame({ ...ok, games });
  assert.equal(checkAll(games), true);
  fs.writeFileSync(path.join(games, 'loose.txt'), 'x');
  assert.equal(checkAll(games), false);
  fs.rmSync(path.join(games, 'loose.txt'));
  if (process.platform !== 'win32') {
    fs.symlinkSync(dir, path.join(games, 'linked'));
    assert.equal(checkAll(games), false);
    fs.rmSync(path.join(games, 'linked'));
  }
  fs.renameSync(dir, path.join(games, 'other'));
  assert.equal(checkAll(games), false);
  assert.ok(quiet[1].mock.callCount() >= 2);
});
test('neither seat of the starter wins nearly always', () => {
  for (const size of ['5', '7']) {
    let first = 0;
    const games = 200;
    for (let g = 0; g < games; g++) {
      const random = createRandom(g.toString(16).padStart(32, '0'));
      let s = starter.setup({ random, options: { size } });
      while (!starter.result(s)) s = starter.move(s, s.turn, starter.bot(s, s.turn, random));
      first += starter.result(s).winner === 0;
    }
    assert.ok(first / games > 0.35 && first / games < 0.65, `${size}: ${first} of ${games}`);
  }
});
