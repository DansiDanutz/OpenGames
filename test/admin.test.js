import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readLibrary } from '../app/library.js';
import { createIdentity, sign } from '../app/shell/session.js';
import { createAccounts } from '../server/accounts.js';
import { createReport, readAdmins } from '../server/admin.js';
import { createLeaderboard } from '../server/leaderboard.js';
import { startMatchServer } from '../server/match-server.js';
import { createStats } from '../server/stats.js';

const ROOT = path.join(import.meta.dirname, '..');
const games = readLibrary(path.join(ROOT, 'games'), path.join(ROOT, 'kit'));
const keyOf = (id) => { const g = games.find((x) => x.id === id); return `${g.id}@${g.hash}`; };
const HOST = 'play.example.org', NOW = Date.UTC(2026, 10, 25, 12);

function setUp(extra = {}) {
  const box = [];
  let now = NOW;
  const accounts = createAccounts({ file: ':memory:', host: () => HOST, clock: () => now, mail: async (m) => { box.push(m); },
    admins: ['boss@example.org'], report: async () => ({ visits: 'some' }), ...extra });
  const body = async (who, action, fields = {}) => {
    now += 1;
    const said = { ...fields, pub: who.pub, at: now };
    return { ...said, sig: await sign(who, { opengames: 'account', host: HOST, action, ...said }) };
  };
  const ask = async (who, action, fields) => accounts.ask(action, await body(who, action, fields));
  const enter = async (who, email) => {
    await ask(who, 'start', { email });
    return ask(who, 'finish', { email, code: box.at(-1).code, name: 'Name' });
  };
  return { accounts, ask, body, enter };
}

test('ADMIN_EMAILS is a list of addresses, and a wrong one stops the server', () => {
  assert.deepEqual(readAdmins(''), []);
  assert.deepEqual(readAdmins(undefined), []);
  assert.deepEqual(readAdmins(' Boss@Example.org , ,ann@example.org'), ['boss@example.org', 'ann@example.org']);
  assert.throws(() => readAdmins('boss@example.org,not an address'), /ADMIN_EMAILS/);
});
test('the signed answer says whether an account is an admin', async () => {
  const s = setUp(), [boss, ann] = [await createIdentity(), await createIdentity()];
  assert.equal((await s.enter(boss, 'BOSS@example.org')).body.admin, true);
  assert.equal((await s.enter(ann, 'ann@example.org')).body.admin, false);
  assert.equal((await s.ask(boss, 'me')).body.admin, true);
  assert.equal((await s.ask(ann, 'me')).body.admin, false);
});
test('only an admin gets the report, with the number of accounts', async () => {
  const s = setUp(), [boss, ann, nobody] = [await createIdentity(), await createIdentity(), await createIdentity()];
  await s.enter(boss, 'boss@example.org');
  await s.enter(ann, 'ann@example.org');
  assert.deepEqual(await s.ask(boss, 'admin'), { status: 200, body: { visits: 'some', accounts: 2 } });
  assert.deepEqual(await s.ask(ann, 'admin'), { status: 403, body: { error: 'not_admin' } });
  assert.deepEqual(await s.ask(nobody, 'admin'), { status: 401, body: { error: 'not_signed_in' } });
});
test('a report request works once and must be signed by the device', async () => {
  const s = setUp(), [boss, eve] = [await createIdentity(), await createIdentity()];
  await s.enter(boss, 'boss@example.org');
  const once = await s.body(boss, 'admin');
  assert.equal((await s.accounts.ask('admin', once)).status, 200);
  assert.equal((await s.accounts.ask('admin', once)).status, 401);
  const forged = { ...(await s.body(eve, 'admin')), pub: boss.pub };
  assert.equal((await s.accounts.ask('admin', forged)).status, 401);
  assert.equal((await s.accounts.ask('admin', { ...(await s.body(boss, 'admin')), extra: 1 })).status, 400);
});
test('without admins nobody is an admin, and a failing report is an error, not a crash', async () => {
  const none = setUp({ admins: [] }), boss = await createIdentity();
  await none.enter(boss, 'boss@example.org');
  assert.equal((await none.ask(boss, 'admin')).status, 403);
  const broken = setUp({ report: async () => { throw new Error('disk'); } }), b2 = await createIdentity();
  await broken.enter(b2, 'boss@example.org');
  assert.deepEqual(await broken.ask(b2, 'admin'), { status: 500, body: { error: 'failed' } });
});
test('the report: visits, matches per game, ranked players and GitHub', async () => {
  const stats = createStats({ file: ':memory:', library: games, clock: () => NOW });
  stats.played(keyOf('shikaku'), ['1', '2']);
  stats.visited('/');
  const leaderboard = { players: (id) => (id === 'shikaku' ? 2 : 0), everyone: () => 2 };
  const report = createReport({ games, stats, leaderboard, github: { facts: async () => ({ github: null, reason: 'GitHub answered 403' }) } });
  const r = await report();
  assert.equal(r.visits.days.at(-1).total, 1);
  assert.deepEqual(r.visits.pages, [{ page: '/', today: 1, week: 1, month: 1 }]);
  assert.deepEqual(r.games.find((g) => g.id === 'shikaku'), { id: 'shikaku', name: 'Shikaku', today: 1, week: 1, month: 1, total: 1, ranked: 2 });
  assert.equal(r.games.length, games.length);
  assert.equal(r.ranked, 2);
  assert.equal(r.since, '2026-11-25');
  assert.deepEqual([r.github, r.reason], [null, 'GitHub answered 403']);
  stats.close();
});
test('the report works without counts, leaderboards or GitHub', async () => {
  const r = await createReport({ games })();
  assert.deepEqual([r.visits, r.ranked, r.github, r.reason, r.games[0].total], [null, null, null, 'off', null]);
});
test('the leaderboard counts each ranked person once', () => {
  const lb = createLeaderboard({ file: ':memory:', library: games.map((g) => ({ ...g, rulesPath: path.join(g.dir, g.rules) })) });
  assert.equal(lb.everyone(), 0);
  lb.close();
});
test('the server answers the admin action over HTTP', async () => {
  const s = setUp(), boss = await createIdentity();
  await s.enter(boss, 'boss@example.org');
  const server = await startMatchServer({ accounts: s.accounts });
  const post = async (fields) => fetch(`http://127.0.0.1:${server.port}/account/admin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(fields) });
  const ok = await post(await s.body(boss, 'admin'));
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { visits: 'some', accounts: 1 });
  assert.deepEqual(await (await fetch(`http://127.0.0.1:${server.port}/account`)).json(), { on: true, email: true, google: false });
  await server.close();
  s.accounts.close();
});
