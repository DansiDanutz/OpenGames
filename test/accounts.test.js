import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanEmail, createAccounts } from '../server/accounts.js';
import { createLeaderboard } from '../server/leaderboard.js';
import { createMail } from '../server/mail.js';
import { startMatchServer } from '../server/match-server.js';
import { createSite } from '../server/site.js';
import { createIdentity, sign } from '../app/shell/session.js';

const HOST = 'play.example.org', NOW = Date.UTC(2026, 10, 25, 12);
function setUp(extra = {}) {
  const box = [], log = [];
  let now = NOW;
  const accounts = createAccounts({ file: ':memory:', host: () => HOST, clock: () => now, mail: async (m) => { box.push(m); }, moved: (m) => log.push(m), removed: (id) => log.push({ removed: id }), ...extra });
  const ask = async (who, action, body = {}, change = {}) => {
    const said = { ...body, pub: who.pub, at: now };
    return accounts.ask(action, { ...said, sig: await sign(who, { opengames: 'account', host: HOST, action, ...said }), ...change });
  };
  const enter = async (who, email = 'ann@example.org', name = 'Ann') => {
    await ask(who, 'start', { email });
    return ask(who, 'finish', { email, code: box.at(-1).code, name });
  };
  return { accounts, ask, enter, box, log, wait: (ms) => { now += ms; } };
}
test('a code signs a device in, and the device stays signed in', async () => {
  const s = setUp(), ann = await createIdentity();
  const out = await s.enter(ann);
  assert.deepEqual([out.status, out.body.email, out.body.name], [200, 'ann@example.org', 'Ann']);
  assert.match(s.box[0].code, /^\d{6}$/);
  s.wait(400 * 24 * 60 * 60 * 1000);
  assert.deepEqual((await s.ask(ann, 'me')).body, out.body);
  assert.equal(s.accounts.owner(ann.pub), out.body.id);
});
test('a second device gets the same account and its name', async () => {
  const s = setUp(), [a, b] = [await createIdentity(), await createIdentity()];
  const first = await s.enter(a), second = await s.enter(b, ' ANN@Example.org', 'Other');
  assert.equal(second.body.id, first.body.id);
  assert.equal(second.body.name, 'Ann');
  assert.deepEqual(s.log, [{ from: a.pub, to: first.body.id }, { from: b.pub, to: first.body.id }]);
});
test('a code works once, for a short time, and only on the device that asked', async () => {
  const s = setUp(), [a, b] = [await createIdentity(), await createIdentity()], email = 'ann@example.org';
  await s.ask(a, 'start', { email });
  const [{ code }] = s.box;
  assert.equal((await s.ask(b, 'finish', { email, code })).body.error, 'wrong_code');
  assert.equal((await s.ask(a, 'finish', { email: 'bob@example.org', code })).body.error, 'wrong_code');
  s.wait(11 * 60 * 1000);
  assert.equal((await s.ask(a, 'finish', { email, code })).body.error, 'wrong_code');
  await s.ask(a, 'start', { email });
  const fresh = s.box[1].code;
  assert.equal((await s.ask(a, 'finish', { email, code: fresh })).status, 200);
  assert.equal((await s.ask(a, 'finish', { email, code: fresh })).body.error, 'wrong_code');
});
test('a code cannot be guessed', async () => {
  const s = setUp(), a = await createIdentity(), email = 'ann@example.org';
  await s.ask(a, 'start', { email });
  const { code } = s.box[0], wrong = code === '000000' ? '000001' : '000000';
  for (let i = 0; i < 5; i++) assert.equal((await s.ask(a, 'finish', { email, code: wrong })).body.error, 'wrong_code');
  assert.equal((await s.ask(a, 'finish', { email, code })).body.error, 'wrong_code');
});
test('somebody else asking for a code does not spoil mine', async () => {
  const s = setUp(), [a, eve] = [await createIdentity(), await createIdentity()], email = 'ann@example.org';
  await s.ask(a, 'start', { email });
  await s.ask(eve, 'start', { email });
  assert.equal((await s.ask(a, 'finish', { email, code: s.box[0].code })).status, 200);
});
test('an address and the whole server only get so many mails', async () => {
  const s = setUp({ limits: { mailsPerDay: 5 } }), a = await createIdentity(), email = 'ann@example.org';
  for (let i = 0; i < 3; i++) assert.equal((await s.ask(a, 'start', { email })).status, 200);
  assert.equal((await s.ask(a, 'start', { email })).status, 429);
  s.wait(61 * 60 * 1000);
  assert.equal((await s.ask(a, 'start', { email })).status, 200);
  assert.equal((await s.ask(a, 'start', { email: 'bob@example.org' })).status, 200);
  assert.equal((await s.ask(a, 'start', { email: 'eve@example.org' })).status, 503);
  s.wait(25 * 60 * 60 * 1000);
  assert.equal((await s.ask(a, 'start', { email: 'eve@example.org' })).status, 200);
});
test('a mail that cannot be sent is said, and its code is gone', async (t) => {
  t.mock.method(console, 'error', () => {});
  const s = setUp({ mail: async () => { throw new Error('no'); } }), a = await createIdentity();
  assert.equal((await s.ask(a, 'start', { email: 'ann@example.org' })).body.error, 'not_sent');
});
test('only the device itself, here and now, can ask', async () => {
  const s = setUp(), [a, b] = [await createIdentity(), await createIdentity()];
  await s.enter(a);
  for (const change of [{ sig: 'f'.repeat(128) }, { sig: undefined }, { at: NOW - 60 * 60 * 1000 }, { at: 'now' }, { pub: b.pub }, { name: 'added' }]) assert.equal((await s.ask(a, 'me', {}, change)).status, 401, JSON.stringify(change));
  const said = { pub: a.pub, at: NOW };
  for (const part of [{ host: 'evil.example' }, { action: 'leave' }, { opengames: 'match' }]) assert.equal((await s.accounts.ask('me', { ...said, sig: await sign(a, { opengames: 'account', host: HOST, action: 'me', ...said, ...part }) })).status, 401);
  for (const bad of [null, [], 'x', {}, { pub: [a.pub] }, { pub: 'x' }]) assert.equal((await s.accounts.ask('me', bad)).status, 400);
});
test('signing out, renaming and deleting', async () => {
  const s = setUp(), [a, b] = [await createIdentity(), await createIdentity()];
  const { body: { id } } = await s.enter(a);
  await s.enter(b);
  assert.equal((await s.ask(a, 'name', { name: 'Anna <b>' })).body.name, 'Anna b');
  assert.equal((await s.ask(b, 'me')).body.name, 'Anna b');
  await s.ask(a, 'leave');
  assert.deepEqual((await s.ask(a, 'me')).body, { signedIn: false });
  assert.equal((await s.ask(a, 'name', { name: 'x' })).status, 401);
  assert.equal((await s.ask(a, 'remove')).status, 401);
  await s.ask(b, 'remove');
  assert.deepEqual(s.log.at(-1), { removed: id });
  assert.equal(s.accounts.owner(b.pub), b.pub);
  assert.notEqual((await s.enter(a)).body.id, id);
});
test('an account has a limited number of devices, the newest', async () => {
  const s = setUp({ limits: { devices: 2, codesPerHour: 9, codesPerDay: 9 } }), all = [];
  for (let i = 0; i < 3; i++) { all.push(await createIdentity()); await s.enter(all[i]); s.wait(1000); }
  assert.deepEqual(await Promise.all(all.map(async (d) => (await s.ask(d, 'me')).body.signedIn)), [false, true, true]);
});
test('addresses are plain', () => {
  assert.equal(cleanEmail(' Ann.B+x@Mail.Example.org '), 'ann.b+x@mail.example.org');
  for (const bad of ['', 'ann', 'ann@x', '@x.org', 'a b@x.org', 'a@x.org,b@x.org', 'Ann <a@x.org>', 'a@x.org\nbcc: b@x.org', '"a"@x.org', 'a@-x.org', `${'a'.repeat(65)}@x.org`, `a@${'x.'.repeat(150)}org`, null, 1, ['a@x.org'], {}]) assert.equal(cleanEmail(bad), null, String(bad));
});
test('a deleted address is gone from the disk', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-acc-')), s = setUp({ file: path.join(dir, 'a.db') }), a = await createIdentity();
  await s.enter(a, 'verysecret@example.org');
  await s.ask(a, 'remove');
  s.accounts.close();
  for (const f of fs.readdirSync(dir)) assert.doesNotMatch(fs.readFileSync(path.join(dir, f), 'latin1'), /verysecret/);
  fs.rmSync(dir, { recursive: true });
});
test('the mail has the code and nothing of the key is shown when it fails', async () => {
  const calls = [], mail = createMail({ key: 'KEY123', from: 'OpenGames <login@example.org>', fetcher: async (...x) => { calls.push(x); return { ok: calls.length === 1, status: 403 }; } });
  await mail({ to: 'ann@example.org', code: '123456' });
  const [url, init] = calls[0], body = JSON.parse(init.body);
  assert.equal(url, 'https://api.resend.com/emails');
  assert.deepEqual([body.to, body.subject.includes('123456'), init.headers.authorization], [['ann@example.org'], true, 'Bearer KEY123']);
  await assert.rejects(mail({ to: 'ann@example.org', code: '123456' }), (e) => /403/.test(e.message) && !/KEY123/.test(e.message));
});
test('points follow a device into its account, and leave with it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-lb-')), file = path.join(dir, 'l.db');
  const b = createLeaderboard({ file, library: [] });
  b.move({ from: 'x', to: 'y' });
  b.remove('y');
  assert.deepEqual(b.top('shikaku'), []);
  b.close();
  fs.rmSync(dir, { recursive: true });
});
test('the server offers sign-in only when it is set up, within limits', async () => {
  const off = await startMatchServer({});
  assert.deepEqual(await (await fetch(`http://127.0.0.1:${off.port}/account`)).json(), { on: false });
  assert.equal((await fetch(`http://127.0.0.1:${off.port}/account/me`, { method: 'POST', body: '{}' })).status, 404);
  await off.close();
  const s = setUp(), on = await startMatchServer({ accounts: s.accounts, limits: { accountsPerMinute: 4 }, site: createSite({ games: [], contact: 'privacy@example.org <b>' }) });
  const post = (action, body) => fetch(`http://127.0.0.1:${on.port}/account/${action}`, { method: 'POST', body });
  assert.deepEqual(await (await fetch(`http://127.0.0.1:${on.port}/account`)).json(), { on: true });
  assert.equal((await post('me', 'x')).status, 400);
  assert.equal((await post('me', `"${'x'.repeat(5000)}"`)).status, 413);
  assert.equal((await post('constructor', '{}')).status, 404);
  assert.equal((await post('me', '{}')).status, 400);
  await post('me', '{}');
  assert.equal((await post('me', '{}')).status, 429);
  const page = await (await fetch(`http://127.0.0.1:${on.port}/privacy`)).text();
  assert.ok(page.includes('privacy@example.org &#60;b&#62;'));
  await on.close();
});
