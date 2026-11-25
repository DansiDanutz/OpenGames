/* The app in a browser, on a phone's screen: node test/web.e2e.js [webkit] */
import assert from 'node:assert/strict';
import { chromium, webkit, devices } from 'playwright-core';
import { readLibrary } from '../app/library.js';
import { createAccounts } from '../server/accounts.js';
import { createReport } from '../server/admin.js';
import { createStats } from '../server/stats.js';
import { inviteLink } from '../app/shell/invite.js';
import { createLeaderboard } from '../server/leaderboard.js';
import { startMatchServer } from '../server/match-server.js';
import { createPlay } from '../server/play.js';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..'), isWebkit = process.argv[2] === 'webkit';
const games = readLibrary(path.join(ROOT, 'games'), path.join(ROOT, 'kit'));
const leaderboard = createLeaderboard({ file: ':memory:', library: games.map((g) => ({ ...g, rulesPath: path.join(g.dir, g.rules) })) });
const box = [];
let at = '';
const stats = createStats({ file: ':memory:', library: games });
for (const page of ['/', '/', '/play']) stats.visited(page);
/* What GitHub would say, with a title that must stay text. */
const github = { facts: async () => ({ github: { repo: 'DansiDanutz/OpenGames', url: 'https://github.com/DansiDanutz/OpenGames', stars: 7, forks: 2, watchers: 1, creatorsRoom: 'https://github.com/DansiDanutz/OpenGames-creators/settings/access',
  open: [{ number: 14, title: '<img src=x onerror=alert(1)> Neon', author: 'cleo', url: 'https://github.com/DansiDanutz/OpenGames/pull/14', createdAt: '2026-11-24T09:00:00Z', games: ['neon'] }],
  merged: [{ number: 12, title: 'Shikaku neon', author: 'cleo', url: 'https://github.com/DansiDanutz/OpenGames/pull/12', mergedAt: '2026-11-25T09:00:00Z', invite: true },
    { number: 11, title: 'Fix', author: 'DansiDanutz', url: 'https://github.com/DansiDanutz/OpenGames/pull/11', mergedAt: '2026-11-24T09:00:00Z', invite: false }] } }) };
const accounts = createAccounts({ file: ':memory:', host: () => new URL(at).host, mail: async (m) => { box.push(m); },
  admins: ['ann@example.org'], report: createReport({ games, stats, leaderboard, github }),
  // Google itself is played by the page below.
  google: { begin: () => { const state = crypto.randomUUID(); return { state, verifier: 'v', nonce: 'n', url: `https://accounts.google.com/o/oauth2/v2/auth?state=${state}` }; }, finish: async () => 'bea@gmail.com' } });
const server = await startMatchServer({ leaderboard, accounts, site: createPlay({ games }), limits: { rankSameAddress: true } });
at = `http://127.0.0.1:${server.port}`;
const browser = await (isWebkit ? webkit.launch() : chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] }));
const errors = [];
async function open(hash = '') {
  const context = await browser.newContext(devices[isWebkit ? 'iPhone 13' : 'Pixel 7']);
  const page = await context.newPage();
  // So that the test can cut every line of this phone, as another app does.
  await page.addInitScript(() => {
    globalThis.lines = [];
    for (const name of ['WebSocket', 'RTCPeerConnection']) {
      const Real = globalThis[name];
      globalThis[name] = class extends Real { constructor(...x) { super(...x); globalThis.lines.push(this); } };
    }
  });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${at}/play${hash}`);
  await page.waitForSelector('#games li', { state: 'attached' });
  return page;
}
const card = (p, name) => p.locator('#games li').filter({ hasText: name }).first();
const shot = (p, name) => process.env.SHOTS && p.screenshot({ path: path.join(process.env.SHOTS, `web-${isWebkit ? 'ios' : 'android'}-${name}.png`) });
/* One sea at a time, with cells large enough for a finger, and the other one is shown when it is its turn. */
async function fleetOnPhone(page, frame) {
  await frame.click('#go');
  const seen = () => frame.evaluate(() => ['theirs', 'mine'].filter((id) => Math.abs(document.getElementById(id).getBoundingClientRect().left) < 2));
  const mySea = (id) => frame.waitForFunction((x) => document.body.dataset.side === x, id, { timeout: 20_000 });
  for (let i = 0; i < 2; i++) {
    await frame.waitForFunction(() => /^Your shot/.test(document.getElementById('whose').textContent), null, { timeout: 20_000 });
    await mySea('theirs');
    await page.waitForTimeout(600);
    assert.deepEqual(await seen(), ['theirs']);
    const cell = await frame.evaluate(async () => {
      const el = document.getElementById("theirs"), box = el.getBoundingClientRect(), { n } = document.getElementById('mine').inspect();
      const { x, y } = el.pointOf(0, 0), next = el.pointOf(0, 1);
      return { n, x, y, width: next.x - x, box: [box.width, innerWidth], fits: document.documentElement.scrollWidth <= innerWidth };
    });
    assert.ok(cell.fits && cell.box[0] === cell.box[1], JSON.stringify(cell));
    assert.ok(cell.width > (cell.box[1] * 0.84) / cell.n, JSON.stringify(cell));
    if (i === 0) await shot(page, 'avioane-attack');
    // A swipe brings the other card and is never a shot.
    const swipe = (from, to) => frame.evaluate(async ([x0, x1]) => {
      const el = document.elementFromPoint(x0, innerHeight / 2);
      const send = (type, x) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, isPrimary: true, pointerId: 9, button: 0, clientX: x, clientY: innerHeight / 2 }));
      send('pointerdown', x0);
      for (let k = 1; k <= 8; k++) { send('pointermove', x0 + ((x1 - x0) * k) / 8); await new Promise((done) => { setTimeout(done, 15); }); }
      send('pointerup', x1);
      await new Promise((done) => { setTimeout(done, 500); });
    }, [from, to]);
    const shots = () => frame.evaluate(() => JSON.stringify(document.getElementById('mine').inspect().view.log));
    const before = await shots();
    await swipe(330, 90);
    assert.deepEqual(await seen(), ['mine']);
    await swipe(90, 330);
    assert.deepEqual(await seen(), ['theirs']);
    await swipe(200, 180);                               // too short to turn the card
    assert.deepEqual(await seen(), ['theirs']);
    assert.equal(await shots(), before);
    const at = await frame.evaluate((k) => document.getElementById('theirs').pointOf(3 + k, 4), i), area = await page.locator('iframe.game').boundingBox();
    await page.touchscreen.tap(area.x + at.x, area.y + at.y);
    await frame.waitForFunction(() => document.getElementById('mine').inspect().view.log.flat().length > 0);
    await mySea('mine');
    await page.waitForTimeout(400);
    if (i === 0) await shot(page, 'avioane-defend');
  }
  await frame.click('#seeTheirs');
  await page.waitForTimeout(500);
  assert.deepEqual(await seen(), ['theirs']);
}
try {
  const ann = await open();
  assert.ok(await ann.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.equal(await ann.locator('#install').isVisible(), isWebkit);
  if (isWebkit) { await ann.click('#install'); await ann.waitForSelector('text=Add to Home Screen'); }
  await shot(ann, 'library');
  // The same player after a reload: nothing to sign in to.
  const me = () => ann.evaluate(async () => { const { identity } = await import('/app/shell/store.js'); return [(await identity()).pub, localStorage.getItem('name')]; });
  await ann.fill('#name', 'Ann');
  await ann.locator('#name').blur();
  const before = await me();
  await ann.reload();
  await ann.waitForSelector('#games li');
  assert.deepEqual(await me(), before);
  // Signing in with a code, on two devices.
  const signIn = async (p) => {
    await p.click('#account');
    await p.fill('#emailInput', 'ann@example.org');
    await p.click('#step-email .go');
    await p.waitForSelector('text=We sent six numbers');
    await shot(p, 'signin');
    await p.fill('#codeInput', '12');
    await p.click('#step-code .go');
    await p.waitForSelector('text=That code is wrong');
    await p.fill('#codeInput', box.at(-1).code);
    await p.click('#step-code .go');
    await p.waitForSelector('text=Signed in as ann@example.org');
  };
  await signIn(ann);
  await ann.reload();
  await ann.waitForSelector('#account:has-text("Account")');
  // Ann is an admin: the server said so in its signed answer.
  await ann.click('#account');
  await ann.click('#adminOpen');
  await ann.waitForSelector('text=Invite cleo to the Creators room');
  await shot(ann, 'admin');
  if (process.env.SHOTS) await ann.screenshot({ path: path.join(process.env.SHOTS, `web-${isWebkit ? 'ios' : 'android'}-admin-full.png`), fullPage: true });
  assert.equal(await ann.getAttribute('text=Invite cleo to the Creators room', 'href'), 'https://github.com/DansiDanutz/OpenGames-creators/settings/access');
  assert.equal(await ann.locator('text=Invite DansiDanutz').count(), 0);
  assert.equal(await ann.locator('#adminBody img').count(), 0);
  assert.equal(await ann.textContent('#adminBody a[href$="/pull/14"]'), '<img src=x onerror=alert(1)> Neon');
  const report = await ann.evaluate(() => ({ text: document.getElementById('adminBody').textContent, fits: document.documentElement.scrollWidth <= innerWidth }));
  assert.ok(report.fits, 'the admin view fits a phone');
  for (const fact of ['Accounts', 'Ranked players', 'Stars', 'Matches per game', 'Shikaku', 'neon', 'Visits per page', 'Home']) assert.ok(report.text.includes(fact), fact);
  await ann.click('#adminBack');
  await ann.waitForSelector('text=Signed in as ann@example.org');
  await ann.click('#signinBack');
  const other = await open();
  await signIn(other);
  assert.equal(await other.inputValue('#name'), 'Ann');
  await other.click('#accountRemove');
  await other.click('text=Delete it and my points for good');
  await other.waitForSelector('text=Your account is deleted');
  await other.context().close();
  await ann.reload();
  await ann.waitForSelector('#account:has-text("Sign in")');
  // Signing in with Google, on the way to an invite.
  const bea = await open('#shikaku=ABCD2345&by=Cleo');
  await bea.route('https://accounts.google.com/**', (route) => route.fulfill({ contentType: 'text/html', body: `<meta http-equiv="refresh" content="0;url=${at}/account/google?code=abc&amp;state=${new URL(route.request().url()).searchParams.get('state')}">` }));
  await bea.waitForSelector('text=Cleo invites you to play');
  await bea.click('#account');
  await shot(bea, 'google');
  await bea.click('#googleGo');
  await bea.waitForSelector('text=Signed in as bea@gmail.com');
  assert.equal(await bea.isVisible('#adminOpen'), false);
  assert.equal(new URL(bea.url()).hash, '');
  await bea.click('#signinBack');
  await bea.waitForSelector('text=Cleo invites you to play');
  await bea.reload();
  await bea.waitForSelector('#account:has-text("Account")');
  await bea.context().close();
  // Every game opens in its locked frame and starts against the computer.
  for (const g of games) {
    await card(ann, g.name).getByText('Play', { exact: true }).click();
    await ann.waitForSelector('#share:not([hidden])');
    await ann.click('#solo');
    await ann.waitForFunction(() => document.getElementById('status').textContent === 'Playing', null, { timeout: 20_000 });
    const frame = ann.frames().find((f) => f.url().includes(`/table/${g.id}/`));
    const inside = await frame.evaluate(async () => {
      const tries = { origin, rtc: typeof RTCPeerConnection, parent: 'reached', storage: 'reached', net: 'reached' };
      try { void parent.document; } catch { tries.parent = 'blocked'; }
      try { void localStorage; } catch { tries.storage = 'blocked'; }
      try { await fetch('/web/games.json'); } catch { tries.net = 'blocked'; }
      return tries;
    });
    assert.deepEqual(inside, { origin: 'null', rtc: 'undefined', parent: 'blocked', storage: 'blocked', net: 'blocked' });
    // A frame of its own does not give back what was taken away.
    assert.equal(await frame.evaluate(() => {
      const f = document.createElement('iframe');
      document.body.append(f);
      try { return typeof f.contentWindow.RTCPeerConnection; } catch { return 'blocked'; } finally { f.remove(); }
    }), 'blocked');
    await ann.waitForTimeout(800);
    await shot(ann, g.id);
    if (g.id === 'avioane') await fleetOnPhone(ann, frame);
    await ann.click('#leave');
    await ann.waitForFunction(() => document.getElementById('leave').textContent === 'Back to games');
    await ann.click('#leave');
  }
  // A game that tries to leave its frame gets nowhere.
  await card(ann, 'Shikaku').getByText('Play', { exact: true }).click();
  await ann.click('#solo');
  await ann.waitForFunction(() => document.getElementById('status').textContent === 'Playing');
  const asked = [];
  ann.on('request', (r) => asked.push(r.url()));
  await ann.frames().find((f) => f.url().includes('/table/')).evaluate((url) => {
    try { top.location.href = url; } catch { /* refused */ }
    location.href = url;
  }, `http://localhost:${server.port}/health`).catch(() => {});
  await ann.waitForTimeout(800);
  assert.match(await ann.textContent('#status'), /stopped working/);
  assert.equal(new URL(ann.url()).pathname, '/play');
  console.log('a game asked for:', asked.filter((u) => u.includes('localhost')));
  await ann.click('#leave');
  // An invite opens the match on the friend's phone.
  await ann.evaluate(() => { globalThis.sent = []; globalThis.open = (url) => { globalThis.sent.push(url); }; });
  await card(ann, 'Shikaku').getByText('Play', { exact: true }).click();
  await ann.waitForSelector('#share:not([hidden])');
  await ann.waitForFunction(() => /^[A-Z2-9]{8}$/.test(document.getElementById('code').textContent));
  await ann.click('#share [data-how=whatsapp]');
  await ann.waitForSelector('text=WhatsApp is opening');
  const said = new URL((await ann.evaluate(() => globalThis.sent))[0]).searchParams.get('text');
  await shot(ann, 'invite');
  const code = await ann.textContent('#code');
  assert.ok(said.includes(code));
  const explain = async (error) => {
    for (const p of [ann, bob]) console.log(await p.evaluate(() => JSON.stringify([document.body.dataset.screen, ...['status', 'mode', 'notice', 'waitTitle', 'waitText'].map((id) => document.getElementById(id).textContent), document.querySelectorAll('iframe').length])));
    console.log(errors.filter((e) => !/Content.Security.Policy/.test(e)));
    throw error;
  };
  const cut = (p) => p.evaluate(() => globalThis.lines.splice(0).forEach((x) => x.close()));
  const playing = (p) => p.waitForFunction(() => document.body.dataset.screen === 'match' && document.getElementById('status').textContent === 'Playing', null, { timeout: 20_000 }).catch(explain);
  // The room waits while its player is in another app, and the page may even be thrown away meanwhile.
  await cut(ann);
  await ann.waitForFunction((c) => document.getElementById('code').textContent === c && !document.getElementById('share').hidden, code);
  await ann.reload();
  await ann.waitForSelector('#share:not([hidden])');
  assert.equal(await ann.textContent('#code'), code);
  const terms = JSON.parse(await ann.evaluate(() => localStorage.getItem('terms:shikaku')));
  const bob = await open(new URL(inviteLink({ game: games.find((g) => g.id === 'shikaku'), code, server: 'https://x.example', terms, name: 'Ann' })).hash);
  await bob.waitForSelector('text=Ann invites you to play');
  await bob.waitForTimeout(300);
  assert.equal(server.counts().open, 1);
  assert.equal(await ann.evaluate(() => document.body.dataset.screen), 'room');       // nobody is connected by a link alone
  await shot(bob, 'invited');
  assert.equal(new URL(bob.url()).hash, '');
  const began = Date.now();
  await bob.click('#invitedYes');
  for (const p of [ann, bob]) await playing(p);
  console.log('connection:', await bob.textContent('#mode'), `${Date.now() - began} ms after one tap`);
  // The line is lost in the middle of a match, on either side, and the match goes on.
  for (const p of [ann, bob]) {
    const from = Date.now();
    await cut(p);
    await p.waitForFunction(() => document.getElementById('status').textContent !== 'Playing', null, { timeout: 20_000 }).catch(explain);
    for (const q of [ann, bob]) await playing(q);
    console.log('back after', Date.now() - from, 'ms,', await p.textContent('#mode'));
  }
  const filled = () => ann.frames().find((f) => f.url().includes('/table/')).evaluate(() => document.getElementById('theirs').value);
  await bob.frames().find((f) => f.url().includes('/table/')).evaluate(async () => {
    const { solve } = await import('./rules.js'), b = document.getElementById('board'), [x] = solve(b.inspect().puzzle);
    b.setPointerCapture = () => {};
    for (const [type, r, c] of [['pointerdown', x.r0, x.c0], ['pointermove', x.r1, x.c1], ['pointerup', x.r1, x.c1]]) { const p = b.pointOf(r, c); b.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, buttons: 1, clientX: p.x, clientY: p.y })); }
  });
  for (let i = 0; i < 40 && !(await filled()); i++) await ann.waitForTimeout(100);
  assert.ok(await filled() > 0, 'a move after the line came back arrives');
  // A page that a phone throws away in a match: the match is lost, the room is not.
  await ann.reload();
  await bob.waitForSelector('#again:not([hidden])', { timeout: 20_000 }).catch(explain);
  await ann.waitForSelector('#again:not([hidden])', { timeout: 20_000 }).catch(explain);
  await ann.click('#again');
  await bob.waitForSelector('text=wants to play again');
  await bob.waitForTimeout(1500);
  await shot(bob, 'again');
  await bob.click('#again');
  for (const p of [ann, bob]) await playing(p);
  await bob.click('#leave');
  await ann.waitForSelector('text=gave up');
  await bob.click('#leave');
  await card(bob, 'Shikaku').getByText('Leaderboard').click();
  await bob.waitForFunction(() => document.querySelector('#boardRows tr') || /Nobody/.test(document.getElementById('boardText').textContent));
  console.log('leaderboard:', await bob.textContent('#boardRows'));
  // The games' own checks above cause these, and nothing else may.
  assert.deepEqual(errors.filter((e) => !/Content Security Policy|connect-src|frame-src|sandboxed|Unsafe attempt|Refused|Blocked|Failed to load resource|Fetch API|webrtc|access control|Not allowed/i.test(e)), []);
  console.log(`WEB OK (${isWebkit ? 'webkit' : 'chrome'})`);
} finally {
  await browser.close();
  await server.close();
  leaderboard.close();
  accounts.close();
  stats.close();
}
