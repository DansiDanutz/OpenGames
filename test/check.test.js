import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import dgram from 'node:dgram';
import { checkGame } from '../kit/check.js';
import { readLibrary, readManifest, hashGame } from '../app/library.js';

const ROOT = path.join(import.meta.dirname, '..');
function hostile(t, code) {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'og-check-')), 'shikaku');
  fs.cpSync(path.join(ROOT, 'games/shikaku'), dir, { recursive: true });
  t.after(() => fs.rmSync(path.dirname(dir), { recursive: true }));
  fs.appendFileSync(path.join(dir, 'rules.js'), `\n${code(path.join(path.dirname(dir), 'PWNED'))}\n`);
  return { dir, proof: path.join(path.dirname(dir), 'PWNED') };
}
const NODE = "[]['const' + 'ructor']['const' + 'ructor']('return pro' + 'cess')()";
test('rules that get past the words check still cannot write, run programs, read files or use the network', async (t) => {
  const tries = {
    write: (f) => `${NODE}.getBuiltinModule('fs').writeFileSync(${JSON.stringify(f)}, 'x');`,
    run: (f) => `${NODE}.getBuiltinModule('child_process').execFileSync('/usr/bin/touch', [${JSON.stringify(f)}]);`,
    read: () => `${NODE}.getBuiltinModule('fs').readFileSync('/etc/hosts');`,
    worker: () => `new (${NODE}.getBuiltinModule('worker_threads').Worker)('1', { ['ev' + 'al']: true });`,
  };
  for (const [name, code] of Object.entries(tries)) {
    const { dir, proof } = hostile(t, code);
    assert.throws(() => checkGame(dir), /restricted|permission/i, name);
    assert.equal(fs.existsSync(proof), false, name);
  }
  // Windows always gives a program a few variables of its own; ours must not be among them.
  process.env.OPENGAMES_TEST_VALUE = 'private';
  t.after(() => { delete process.env.OPENGAMES_TEST_VALUE; });
  const { dir } = hostile(t, () => `if (${NODE}.env.OPENGAMES_TEST_VALUE) throw new Error('saw the environment');`);
  assert.doesNotThrow(() => checkGame(dir));
});
test('nothing a game does during the check reaches the network', async (t) => {
  let seen = 0;
  const tcp = net.createServer((s) => { seen++; s.destroy(); }), udp = dgram.createSocket('udp4').on('message', () => { seen++; });
  await new Promise((r) => { tcp.listen(0, '127.0.0.1', r); });
  await new Promise((r) => { udp.bind(0, '127.0.0.1', r); });
  t.after(() => { tcp.close(); udp.close(); });
  for (const code of [`${NODE}.getBuiltinModule('net').connect(${tcp.address().port}, '127.0.0.1').on('error', () => {});`, `const u = ${NODE}.getBuiltinModule('dgram').createSocket('udp4'); u.on('error', () => {}); u.send('x', ${udp.address().port}, '127.0.0.1', () => {});`]) {
    const { dir } = hostile(t, () => `try { ${code} } catch {}`);
    try { checkGame(dir); } catch { /* refused is fine too */ }
  }
  await new Promise((r) => { setTimeout(r, 200); });
  assert.equal(seen, 0);
});
test('rules cannot answer in place of the check', (t) => {
  const { dir } = hostile(t, () => `const p = ${NODE}; p.stdout.write('{"ok":true,"matches":1,"wins":[1,0]}'); p.exit(0);`);
  assert.throws(() => checkGame(dir));
});
test('what is hashed at the start is what is played, whatever happens to the files later', (t) => {
  const { dir } = hostile(t, () => '');
  const [game] = readLibrary(path.dirname(dir), path.join(ROOT, 'kit'));
  const before = game.files.get('page.js').toString();
  fs.writeFileSync(path.join(dir, 'page.js'), 'changed');
  assert.equal(game.files.get('page.js').toString(), before);
});
test('an installed app plays approved versions only', (t) => {
  const { dir } = hostile(t, () => ''), kit = path.join(ROOT, 'kit');
  t.mock.method(console, 'error', () => {});
  assert.equal(readLibrary(path.dirname(dir), kit, { shikaku: hashGame(dir) }).length, 1);
  assert.equal(readLibrary(path.dirname(dir), kit, { shikaku: 'f'.repeat(64) }).length, 0);
  assert.equal(readLibrary(path.dirname(dir), kit, {}).length, 0);
});
test('options and rules in a manifest must be well formed', (t) => {
  const { dir } = hostile(t, () => ''), file = path.join(dir, 'game.json'), good = JSON.parse(fs.readFileSync(file));
  const [size] = good.options;
  for (const bad of [{ howto: [] }, { howto: 'x' }, { options: [{}] }, { options: [size, size] }, { options: [{ ...size, default: '99' }] }, { options: [{ ...size, choices: [size.choices[0]] }] }, { options: [{ ...size, id: 'A B' }] }]) {
    fs.writeFileSync(file, JSON.stringify({ ...good, ...bad }));
    assert.throws(() => readManifest(dir), JSON.stringify(bad));
  }
});
test('library.lock.json approves exactly the games that are here', () => {
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'library.lock.json')));
  for (const id of fs.readdirSync(path.join(ROOT, 'games'))) assert.equal(lock[id], hashGame(path.join(ROOT, 'games', id)), id);
});
test('rules cannot skip the matches of the check', (t) => {
  const { dir } = hostile(t, () => 'Array.prototype.reduce = () => [];');
  assert.throws(() => checkGame(dir), /did not play|read only|Cannot assign/);
});
