/* The app in a browser, on a phone's screen: node test/web.e2e.js [webkit] */
import assert from 'node:assert/strict';
import { chromium, webkit, devices } from 'playwright-core';
import { readLibrary } from '../app/library.js';
import { createLeaderboard } from '../server/leaderboard.js';
import { startMatchServer } from '../server/match-server.js';
import { createPlay } from '../server/play.js';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..'), isWebkit = process.argv[2] === 'webkit';
const games = readLibrary(path.join(ROOT, 'games'), path.join(ROOT, 'kit'));
const leaderboard = createLeaderboard({ file: ':memory:', library: games.map((g) => ({ ...g, rulesPath: path.join(g.dir, g.rules) })) });
const server = await startMatchServer({ leaderboard, site: createPlay({ games }), limits: { rankSameAddress: true } });
const at = `http://127.0.0.1:${server.port}`;
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
    if (g.id === 'avioane') await fleetOnPhone(ann, frame);
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
}
