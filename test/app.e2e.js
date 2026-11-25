/* Two real app windows play a match through a real match server. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { _electron } from 'playwright-core';
import dgram from 'node:dgram';
import net from 'node:net';
import { startMatchServer } from '../server/match-server.js';

const require = createRequire(import.meta.url);
const executablePath = require('electron');
const ROOT = path.join(import.meta.dirname, '..');
const SHOTS = process.env.SHOTS;
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'opengames-test-'));
const server = await startMatchServer();
const apps = [];

async function open(who) {
  const app = await _electron.launch({ executablePath, args: [ROOT], env: { ...process.env, OPENGAMES_QUIET: '1',
    OPENGAMES_SERVER: `ws://127.0.0.1:${server.port}`, OPENGAMES_DATA: path.join(data, who) } });
  apps.push(app);
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.waitForSelector('#games li');
  await page.fill('#name', who);
  await page.press('#name', 'Enter');
  return { app, page, who, errors };
}
/* Runs code inside the game's own page. */
const inGame = (p, code) => p.app.evaluate(async ({ webContents }, js) => {
  const game = webContents.getAllWebContents().find((c) => c.getURL().startsWith('og-game://'));
  return game ? game.executeJavaScript(js) : null;
}, code);
const status = (p, re) => p.page.waitForFunction((source) => new RegExp(source).test(document.getElementById('status').textContent), re.source, { timeout: 15000, polling: 100 }).catch(async (error) => {
  const now = await Promise.all(apps.map(async (a) => (await a.firstWindow()).evaluate(() => [document.body.dataset.screen, document.getElementById('status').textContent, document.getElementById('waitTitle').textContent, document.getElementById('mode').textContent, document.getElementById('notice').textContent].join(' | '))));
  throw new Error(`${p.who} waited for ${re}. Windows: ${JSON.stringify(now)}`, { cause: error });
});
const shot = async (p, name) => {
  if (!SHOTS) return;
  const png = await p.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'));
  fs.writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(png, 'base64'));
  const game = await p.app.evaluate(async ({ webContents }) => {
    const c = webContents.getAllWebContents().find((x) => x.getURL().startsWith('og-game://'));
    return c ? (await c.capturePage()).toPNG().toString('base64') : null;
  });
  if (game) fs.writeFileSync(path.join(SHOTS, `${name}-game.png`), Buffer.from(game, 'base64'));
};
/* Counts everything that reaches this computer's network from a page. */
async function listeners() {
  const seen = { udp: 0, tcp: 0 };
  const udp = dgram.createSocket('udp4').on('message', () => { seen.udp++; });
  const tcp = net.createServer((s) => { seen.tcp++; s.destroy(); });
  await new Promise((r) => { udp.bind(0, '127.0.0.1', r); });
  await new Promise((r) => { tcp.listen(0, '127.0.0.1', r); });
  return { seen, udpPort: udp.address().port, tcpPort: tcp.address().port, close: () => { udp.close(); tcp.close(); } };
}
/* Tries to send through WebRTC, from the page itself or from a frame. */
const leak = (l, inFrame) => `(async () => {
  let make = globalThis.RTCPeerConnection;
  if (${inFrame}) { const f = document.createElement('iframe'); document.body.append(f); make = f.contentWindow?.RTCPeerConnection ?? make; }
  if (!make) return 'missing';
  try {
    const pc = new make({ iceServers: [{ urls: 'stun:127.0.0.1:${l.udpPort}' }, { urls: 'turn:127.0.0.1:${l.tcpPort}?transport=tcp', username: 'x', credential: 'x' }, { urls: 'turn:127.0.0.1:${l.udpPort}', username: 'x', credential: 'x' }] });
    const found = [];
    pc.onicecandidate = (e) => { if (e.candidate) found.push(e.candidate.candidate); };
    pc.createDataChannel('x');
    await pc.setLocalDescription(await pc.createOffer());
    await new Promise((r) => setTimeout(r, 2500));
    return 'addresses found: ' + found.length;
  } catch (e) { return 'error ' + e.message; }
})()`;
/* Solves the board with the pointer, as a person would. */
const drag = (rects) => `(() => {
  const b = document.getElementById('board');
  for (const x of ${JSON.stringify(rects)}) {
    const box = b.getBoundingClientRect(), s = box.width / 6;
    const ev = (type, r, c) => b.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, buttons: 1, clientX: box.left + (c + .5) * s, clientY: box.top + (r + .5) * s }));
    b.setPointerCapture = () => {};
    ev('pointerdown', x.r0, x.c0); ev('pointermove', x.r1, x.c1); ev('pointerup', x.r1, x.c1);
  }
})()`;
const solve = (p) => inGame(p, `import('./rules.js').then(({ solve }) => {
  const n = [...document.querySelectorAll('.cell')].map((c) => Number(c.textContent) || 0);
  return solve(Array.from({ length: 6 }, (_, r) => n.slice(r * 6, r * 6 + 6)));
})`);
async function invite(a, b) {
  await a.page.click('text=Invite a friend');
  await a.page.waitForFunction(() => /^[A-Z2-9]{6}$/.test(document.getElementById('code').textContent), null, { polling: 100 });
  const code = await a.page.textContent('#code');
  await shot(a, 'invite');
  await b.page.fill('.join input', code);
  await b.page.click('.join button');
  await Promise.all([a, b].map((p) => status(p, /^Playing$/)));
}

try {
  const [ann, bob] = [await open('Ann'), await open('Bob')];
  await shot(ann, 'library');

  await invite(ann, bob);
  assert.equal(await ann.page.textContent('#mode'), 'Direct connection');
  assert.equal(await bob.page.textContent('#mode'), 'Direct connection');
  assert.equal(await ann.page.textContent('#p0'), 'Ann (you)');
  assert.equal(await bob.page.textContent('#p0'), 'Ann');
  const rects = await solve(bob);
  await inGame(bob, drag(rects.slice(0, 3)));
  await ann.page.waitForTimeout(400);
  assert.ok(await inGame(ann, "document.getElementById('theirs').value") > 0, 'the other player sees the progress');
  await shot(bob, 'match');

  assert.equal(await ann.app.evaluate(({ session }) => session.defaultSession.resolveHost('example.com').then(() => 'found', () => 'refused')), 'refused');
  // A game cannot reach the internet, the shell, the computer or the other player's address.
  const probe = await inGame(ann, `(async () => {
    const tries = { require: typeof require, process: typeof process, desk: typeof desk, rtc: typeof RTCPeerConnection, transport: typeof WebTransport };
    tries.fetch = await fetch('http://127.0.0.1:${server.port}/').then(() => 'reached', () => 'blocked');
    tries.shell = await fetch('og://platform/app/shell/shell.js').then(() => 'reached', () => 'blocked');
    tries.socket = await new Promise((r) => { try { const w = new WebSocket('ws://127.0.0.1:${server.port}'); w.onopen = () => r('reached'); w.onerror = () => r('blocked'); } catch { r('blocked'); } });
    tries.image = await new Promise((r) => { const i = new Image(); i.onload = () => r('reached'); i.onerror = () => r('blocked'); i.src = 'http://127.0.0.1:${server.port}/x.png'; });
    tries.frame = await new Promise((r) => { const f = document.createElement('iframe'); f.srcdoc = '<p>x'; f.onload = () => { try { r(typeof f.contentWindow.RTCPeerConnection); } catch { r('undefined'); } }; document.body.append(f); setTimeout(() => r('blocked'), 1000); });
    tries.popup = window.open('https://example.com') === null ? 'blocked' : 'reached';
    const fr = document.createElement('iframe'); document.body.append(fr);
    const before = Date.now(); alert('x'); confirm('x'); fr.contentWindow?.alert?.('x'); tries.dialog = Date.now() - before < 500 ? 'blocked' : 'shown'; fr.remove();
    tries.copy = document.execCommand('copy') ? 'copied' : 'blocked';
    tries.location = location.href;
    return tries;
  })()`);
  console.log('Game tried:', JSON.stringify(probe));
  assert.deepEqual({ ...probe, location: '', frame: '' }, { require: 'undefined', process: 'undefined', desk: 'undefined', rtc: 'undefined', transport: 'undefined',
    fetch: 'blocked', shell: 'blocked', socket: 'blocked', image: 'blocked', frame: '', popup: 'blocked', dialog: 'blocked', copy: 'blocked', location: '' });
  const control = await listeners(), target = await listeners();
  await ann.page.evaluate(leak(control, false));
  const tried = [await inGame(ann, leak(target, false)), await inGame(ann, leak(target, true))];
  console.log('WebRTC from a game:', JSON.stringify(tried), 'arrived:', JSON.stringify(target.seen), 'from the app itself:', JSON.stringify(control.seen));
  assert.ok(control.seen.udp > 0, 'the listener works');
  assert.deepEqual(target.seen, { udp: 0, tcp: 0 }, 'a game reached the network');
  control.close(); target.close();
  await inGame(ann, "document.querySelector('iframe')?.remove(); location.href = 'https://example.com'; 0");
  await ann.page.waitForTimeout(300);
  assert.match(await inGame(ann, 'location.href'), /^og-game:\/\/shikaku\//);

  await inGame(bob, drag(rects.slice(3)));
  await Promise.all([status(bob, /^You win\.$/), status(ann, /^You lose\.$/)]);
  await shot(bob, 'won');
  for (const p of [ann, bob]) await p.page.click('#leave');
  await bob.page.waitForSelector('text=You won 1 and lost 0');
  await ann.page.waitForSelector('text=You won 0 and lost 1');

  // Hidden address: the match goes through the server.
  await bob.page.check('#hide');
  await invite(ann, bob);
  assert.deepEqual([await ann.page.textContent('#mode'), await bob.page.textContent('#mode')], ['Through the server', 'Through the server']);
  await bob.page.click('#leave');
  await Promise.all([status(bob, /^You gave up\.$/), status(ann, /gave up\.$/)]);
  for (const p of [ann, bob]) await p.page.click('#leave');

  // A player who disappears does not cost the other one a loss.
  await ann.page.click('text=Find a player');
  await ann.page.waitForSelector('text=Looking for a player');
  await bob.page.click('text=Find a player');
  await Promise.all([ann, bob].map((p) => status(p, /^Playing$/)));
  await bob.app.close();
  apps.pop();
  await status(ann, /connection was lost.*does not count/);
  await ann.page.click('#leave');
  await ann.page.waitForSelector('text=You won 1 and lost 1');

  // Games opened and closed quickly: the last one works. A game that floods the app is closed.
  const carl = await open('Carl');
  for (let i = 0; i < 4; i++) { await ann.page.click('text=Find a player'); await ann.page.click('#cancel'); }
  for (let i = 0; i < 2; i++) {
    await invite(ann, carl);
    if (i) await inGame(carl, 'for (let n = 0; n < 1000; n++) opengames.send({ t: "x", n }); 0').catch(() => {});
    else await carl.page.click('#leave');
    await status(ann, i ? /connection was lost/ : /gave up/);
    if (i) await status(carl, /stopped working/);
    for (const p of [ann, carl]) await p.page.click('#leave');
  }
  await ann.page.waitForSelector('text=You won 2 and lost 1');   // the closed match did not count
  // A wrong code, then the server is off.
  await ann.page.fill('.join input', 'AAAAAA');
  await ann.page.click('.join button');
  await ann.page.waitForSelector('text=There is no open match with that code.');
  for (const width of [360, 768, 1080]) {
    await ann.app.evaluate(({ BrowserWindow }, w) => BrowserWindow.getAllWindows()[0].setContentSize(w, 760), width);
    await ann.page.waitForTimeout(150);
    assert.ok(await ann.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.getElementById('library').scrollWidth <= document.getElementById('library').clientWidth), `cut off at ${width}px`);
    await shot(ann, `library-${width}`);
  }
  await server.close();
  await ann.page.click('text=Find a player');
  await ann.page.waitForSelector('text=The match server cannot be reached');
  assert.deepEqual([...ann.errors, ...bob.errors].filter((e) => !/WebSocket|ERR_CONNECTION_REFUSED/.test(e)), []);
  console.log('APP OK: direct match, server match, lost player, wrong code, server off, game locked in');
} finally {
  await Promise.all(apps.map((a) => a.close().catch(() => {})));
  await server.close().catch(() => {});
  fs.rmSync(data, { recursive: true, force: true });
}
