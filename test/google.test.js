import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createAccounts } from '../server/accounts.js';
import { createGoogle } from '../server/google.js';
import { startMatchServer } from '../server/match-server.js';
import { createSite } from '../server/site.js';
import { createIdentity, sign } from '../app/shell/session.js';

const HOST = 'play.example.org', NOW = Date.UTC(2026, 10, 26, 12), ID = 'id.apps.example', SECRET = 'not-a-real-secret';
const jwt = (claims) => `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;
/* A Google that answers with the claims a test wants. */
function fakeGoogle(change = {}, status = 200) {
  const asked = [];
  let nonce = '';
  const google = createGoogle({ id: ID, secret: SECRET, host: () => HOST, clock: () => NOW, fetcher: async (url, options) => {
    asked.push({ url, ...options, form: new URLSearchParams(options.body) });
    return new Response(JSON.stringify({ id_token: jwt({ iss: 'https://accounts.google.com', aud: ID, nonce, exp: NOW / 1000 + 60, email: 'Ann@gmail.com', email_verified: true, ...change }) }), { status });
  } });
  return { asked, google: { ...google, begin() { const b = google.begin(); nonce = b.nonce; return b; } } };
}
function setUp(g = fakeGoogle(), extra = {}) {
  let now = NOW;
  const log = [], accounts = createAccounts({ file: ':memory:', host: () => HOST, clock: () => now, google: g.google, moved: (m) => log.push(m), ...extra });
  const ask = async (who, action, body = {}) => { now += 1; const said = { ...body, pub: who.pub, at: now }; return accounts.ask(action, { ...said, sig: await sign(who, { opengames: 'account', host: HOST, action, ...said }) }); };
  const leave = async (who) => new URL((await ask(who, 'google')).body.url);
  const back = async (who) => accounts.cameBack({ state: (await leave(who)).searchParams.get('state'), code: 'abc' });
  return { accounts, ask, leave, back, log, wait: (ms) => { now += ms; } };
}
test('Google signs a device in, and the device stays signed in', async () => {
  const g = fakeGoogle(), s = setUp(g), ann = await createIdentity(), out = await s.ask(ann, 'enter', { ticket: await s.back(ann), name: 'Ann' });
  assert.deepEqual([out.status, out.body.email, out.body.name], [200, 'ann@gmail.com', 'Ann']);
  assert.deepEqual((await s.ask(ann, 'me')).body, out.body);
  assert.deepEqual(s.log, [{ from: ann.pub, to: out.body.id }]);
  const second = await createIdentity();
  assert.equal((await s.ask(second, 'enter', { ticket: await s.back(second), name: 'X' })).body.id, out.body.id);
  assert.equal(g.asked[0].url, 'https://oauth2.googleapis.com/token');
  assert.equal(g.asked[0].form.get('redirect_uri'), `https://${HOST}/account/google`);
});
test('what is asked of Google: only the address, for this moment, with a proof', async () => {
  const g = fakeGoogle(), s = setUp(g), ann = await createIdentity(), url = await s.leave(ann), p = url.searchParams;
  assert.deepEqual([url.origin, p.get('scope'), p.get('response_type'), p.get('code_challenge_method'), p.get('client_id')], ['https://accounts.google.com', 'openid email', 'code', 'S256', ID]);
  assert.ok(!url.href.includes(SECRET));
  await s.accounts.cameBack({ state: p.get('state'), code: 'abc' });
  assert.equal(createHash('sha256').update(g.asked[0].form.get('code_verifier')).digest('base64url'), p.get('code_challenge'));
});
test('a link sent to somebody else signs nobody in', async () => {
  const s = setUp(), thief = await createIdentity(), victim = await createIdentity();
  const ticket = await s.back(thief);                    // the thief's link, opened by the victim: the ticket is in the victim's browser
  assert.equal((await s.ask(victim, 'enter', { ticket, name: 'V' })).body.error, 'wrong_device');
  assert.equal((await s.ask(thief, 'me')).body.signedIn, false);
});
test('a state and a ticket work once and for a short time', async () => {
  const s = setUp(), ann = await createIdentity(), state = (await s.leave(ann)).searchParams.get('state');
  const ticket = await s.accounts.cameBack({ state, code: 'abc' });
  assert.equal(await s.accounts.cameBack({ state, code: 'abc' }), null);
  assert.equal((await s.ask(ann, 'enter', { ticket, name: 'A' })).status, 200);
  assert.equal((await s.ask(ann, 'enter', { ticket, name: 'A' })).body.error, 'wrong_device');
  const late = await s.back(ann);
  s.wait(3 * 60 * 1000);
  assert.equal((await s.ask(ann, 'enter', { ticket: late, name: 'A' })).body.error, 'wrong_device');
  const old = (await s.leave(ann)).searchParams.get('state');
  s.wait(11 * 60 * 1000);
  assert.equal(await s.accounts.cameBack({ state: old, code: 'abc' }), null);
  for (const bad of [null, undefined, '', 'x'.repeat(50)]) assert.equal(await s.accounts.cameBack({ state: bad, code: 'abc' }), null);
  for (const code of [null, '', 'x'.repeat(3000)]) assert.equal(await s.accounts.cameBack({ state: (await s.leave(await createIdentity())).searchParams.get('state'), code }).catch(() => null), null);
});
test('answers that are not for this request are refused', async () => {
  for (const change of [{ iss: 'https://evil.example' }, { aud: 'other' }, { nonce: 'other' }, { exp: NOW / 1000 - 600 }, { exp: undefined }]) {
    const s = setUp(fakeGoogle(change)), ann = await createIdentity();
    await assert.rejects(s.back(ann), /not an answer/, JSON.stringify(change));
  }
  await assert.rejects(setUp(fakeGoogle({}, 400)).back(await createIdentity()), /answered 400/);
});
test('only an address Google is in charge of counts', async () => {
  for (const [change, ok] of [[{ email_verified: false }, false], [{ email_verified: 'true' }, false], [{ email: 'ann@example.org' }, false], [{ email: 'ann@example.org', hd: 'example.org' }, true], [{ email: 'ann@example.org', hd: 'other.example' }, false], [{ email: 'ann@example.org', hd: '' }, false], [{ email: 'x@evilgmail.com' }, false], [{ email: ['a@gmail.com'] }, false]]) {
    assert.equal(!!(await setUp(fakeGoogle(change)).back(await createIdentity())), ok, JSON.stringify(change));
  }
});
test('a way to sign in that is not set up does not exist', async () => {
  const s = setUp(), none = createAccounts({ file: ':memory:', host: () => HOST, mail: async () => {} });
  assert.deepEqual([s.accounts.has('start'), s.accounts.has('google'), none.has('google'), none.has('enter'), none.has('finish')], [false, true, false, false, true]);
});
test('over HTTP the browser comes back to the app, with the ticket where no server sees it', async () => {
  const s = setUp(), ann = await createIdentity(), state = (await s.leave(ann)).searchParams.get('state');
  const on = await startMatchServer({ accounts: s.accounts, limits: { accountsPerMinute: 3 }, site: createSite({ games: [], contact: 'privacy@example.org', ways: s.accounts.ways }) });
  const get = (path) => fetch(`http://127.0.0.1:${on.port}${path}`, { redirect: 'manual' });
  assert.deepEqual(await (await get('/account')).json(), { on: true, email: false, google: true });
  const res = await get(`/account/google?state=${state}&code=abc`);
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location'), /^\/play#google=[0-9a-f]{64}$/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal((await get('/account/google?error=access_denied')).headers.get('location'), '/play#google=failed');
  await get('/account/google');
  assert.equal((await get('/account/google')).status, 429);
  const page = await (await get('/privacy')).text();
  assert.ok(page.includes('sign in with Google') && !page.includes('Resend'));
  await on.close();
});
test('one address can leave for Google only so often, without using up its email codes', async () => {
  const s = setUp(fakeGoogle(), { mail: async () => {}, limits: { googlesPerHour: 2 } }), ann = await createIdentity();
  assert.deepEqual([(await s.ask(ann, 'google')).status, (await s.ask(ann, 'google')).status, (await s.ask(ann, 'google')).status, (await s.ask(ann, 'start', { email: 'a@example.org' })).status], [200, 200, 429, 200]);
});
