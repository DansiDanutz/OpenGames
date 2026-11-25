import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hashGame, readLibrary, readManifest, resolveFile } from '../app/library.js';
import { createTable, cleanResult } from '../app/shell/table.js';

const ROOT = path.join(import.meta.dirname, '..');
const KIT = path.join(ROOT, 'kit');
const copyGame = (t) => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'og-')), 'shikaku');
  fs.cpSync(path.join(ROOT, 'games/shikaku'), dir, { recursive: true });
  t.after(() => fs.rmSync(path.dirname(dir), { recursive: true }));
  return dir;
};
test('the library lists Shikaku and leaves broken games out', (t) => {
  assert.deepEqual(readLibrary(path.join(ROOT, 'games'), KIT).map((g) => g.id), ['shikaku']);
  const dir = copyGame(t);
  t.mock.method(console, 'error', () => {});
  fs.writeFileSync(path.join(dir, 'game.json'), '{}');
  assert.deepEqual(readLibrary(path.dirname(dir), KIT), []);
});
test('changing any file changes the version of a game', (t) => {
  const dir = copyGame(t), before = hashGame(dir);
  fs.appendFileSync(path.join(dir, 'style.css'), ' ');
  assert.notEqual(hashGame(dir), before);
});
test('links, hidden files and programs are refused', (t) => {
  for (const add of [(d) => fs.symlinkSync('/etc/hosts', path.join(d, 'x.json')), (d) => fs.writeFileSync(path.join(d, '.env'), ''), (d) => fs.writeFileSync(path.join(d, 'run.sh'), '')]) {
    const dir = copyGame(t);
    add(dir);
    assert.throws(() => hashGame(dir));
  }
});
test('a game for one player is refused', (t) => {
  const dir = copyGame(t), file = path.join(dir, 'game.json');
  fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file)), players: { min: 1, max: 1 } }));
  assert.throws(() => readManifest(dir), /two players/);
});
test('no path reaches a file outside the game', (t) => {
  const dir = copyGame(t);
  fs.writeFileSync(path.join(dir, '..', 'secret.json'), '1');
  fs.symlinkSync(path.join(dir, '..', 'secret.json'), path.join(dir, 'link.json'));
  assert.ok(resolveFile(dir, 'index.html'));
  for (const p of ['../secret.json', '%2e%2e/secret.json', '..%2fsecret.json', '/../secret.json', 'link.json', 'LICENSE', '', 'a\0.js', '..\\secret.json', '%', 'missing.js']) assert.equal(resolveFile(dir, p), null, p);
});
test('a game page that is silent or lies is not believed', async () => {
  const quiet = createTable({ send: () => {}, answerMs: 20 });
  await assert.rejects(quiet.start({ seed: 's', me: 0, players: [] }), /stopped answering/);
  await assert.rejects(quiet.tryMove(0, {}), /stopped answering/);
  let t;
  const reply = (extra) => { t = createTable({ send: (m) => queueMicrotask(() => t.receive({ t: 'tried', id: m.id, ...extra })), answerMs: 50 }); return t.tryMove(0, {}); };
  await assert.rejects(reply({ ok: true, fingerprint: 'x' }), /bad answer/);
  await assert.rejects(reply({ ok: true, fingerprint: 'a'.repeat(16), result: { winner: 5 } }), /does not understand/);
  assert.deepEqual(await reply({ ok: 'yes' }), { ok: false, error: 'not allowed' });
  assert.deepEqual(cleanResult({ winner: 1, reason: 9, extra: 1 }), { winner: 1, reason: '' });
});
test('changing the shared kit changes the version players must share', (t) => {
  const kit = fs.mkdtempSync(path.join(os.tmpdir(), 'og-kit-'));
  t.after(() => fs.rmSync(kit, { recursive: true }));
  fs.cpSync(KIT, kit, { recursive: true });
  const hash = () => readLibrary(path.join(ROOT, 'games'), kit)[0].hash, before = hash();
  fs.appendFileSync(path.join(kit, 'engine.js'), ' ');
  assert.notEqual(hash(), before);
});
