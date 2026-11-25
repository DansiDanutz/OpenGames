/* The app in a browser, on a phone's screen: node test/web.e2e.js [webkit] */
import assert from 'node:assert/strict';
import { chromium, webkit, devices } from 'playwright-core';
import { readLibrary } from '../app/library.js';
import { createAccounts } from '../server/accounts.js';
import { createLeaderboard } from '../server/leaderboard.js';
import { startMatchServer } from '../server/match-server.js';
import { createPlay } from '../server/play.js';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..'), isWebkit = process.argv[2] === 'webkit';
const games = readLibrary(path.join(ROOT, 'games'), path.join(ROOT, 'kit'));
const leaderboard = createLeaderboard({ file: ':memory:', library: games.map((g) => ({ ...g, rulesPath: path.join(g.dir, g.rules) })) });
const box = [];
let at = '';
const accounts = createAccounts({ file: ':memory:', host: () => new URL(at).host, mail: async (m) => { box.push(m); } });
const server = await startMatchServer({ leaderboard, accounts, site: createPlay({ games }), limits: { rankSameAddress: true } });
at = `http://127.0.0.1:${server.port}`;
const browser = await (isWebkit ? webkit.launch() : chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] }));
const errors = [];
async function open(hash = '') {
  const context = await browser.newContext(devices[isWebkit ? 'iPhone 13' : 'Pixel 7']);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${at}/play${hash}`);
  await page.waitForSelector('#games li', { state: 'attached' });
  return page;
}
const card = (p, name) => p.locator('#games li').filter({ hasText: name }).first();
const shot = (p, name) => process.env.SHOTS && p.screenshot({ path: path.join(process.env.SHOTS, `web-${isWebkit ? 'ios' : 'android'}-${name}.png`) });
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
  const other = await open();
  await signIn(other);
  assert.equal(await other.inputValue('#name'), 'Ann');
  await other.click('#accountRemove');
  await other.click('text=Delete it and my points for good');
  await other.waitForSelector('text=Your account is deleted');
  await other.context().close();
  await ann.reload();
  await ann.waitForSelector('#account:has-text("Sign in")');
  // Every game opens in its locked frame and starts against the computer.
  for (const g of games) {
    await card(ann, g.name).getByText('Play alone').click();
    await ann.click('#setupGo');
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
    await ann.click('#leave');
    await ann.waitForFunction(() => document.getElementById('leave').textContent === 'Back to games');
    await ann.click('#leave');
  }
  // A game that tries to leave its frame gets nowhere.
  await card(ann, 'Shikaku').getByText('Play alone').click();
  await ann.click('#setupGo');
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
  await card(ann, 'Shikaku').getByText('Invite a friend').click();
  await ann.click('#setupGo');
  await ann.waitForFunction(() => /^[A-Z2-9]{8}$/.test(document.getElementById('code').textContent));
  await ann.click('#share [data-how=whatsapp]');
  await ann.waitForSelector('text=WhatsApp is opening');
  assert.match((await ann.evaluate(() => globalThis.sent))[0], /^https:\/\/wa\.me\/\?text=/);
  await shot(ann, 'invite');
  const code = await ann.textContent('#code');
  const explain = async (error) => {
    for (const p of [ann, bob]) console.log(await p.evaluate(() => JSON.stringify([document.body.dataset.screen, ...['status', 'mode', 'notice', 'waitTitle', 'waitText'].map((id) => document.getElementById(id).textContent), document.querySelectorAll('iframe').length])));
    console.log(errors.filter((e) => !/Content.Security.Policy/.test(e)));
    throw error;
  };
  const bob = await open(`#shikaku=${code}`);
  await bob.waitForSelector('text=A friend invites you to play Shikaku');
  assert.equal(server.counts().open, 1);                 // nobody is connected by a link alone
  await shot(bob, 'invited');
  await bob.click('#invitedYes');
  await bob.waitForSelector('#terms:not([hidden])', { timeout: 20_000 }).catch(explain);
  assert.equal(new URL(bob.url()).hash, '');
  await bob.click('#termsYes');
  for (const p of [ann, bob]) await p.waitForFunction(() => document.getElementById('status').textContent === 'Playing', null, { timeout: 20_000 }).catch(explain);
  console.log('connection:', await bob.textContent('#mode'));
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
}
