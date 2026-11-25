/* Two real app windows play a match through a real match server. */
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import net from 'node:net';
import { accept, apps, choose, closeAll, inGame, invite, open, row, server, shot, status } from './windows.js';

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
    const ev = (type, r, c) => { const p = b.pointOf(r, c); b.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, buttons: 1, clientX: p.x, clientY: p.y })); };
    b.setPointerCapture = () => {};
    ev('pointerdown', x.r0, x.c0); ev('pointermove', x.r1, x.c1); ev('pointerup', x.r1, x.c1);
  }
})()`;
const solve = (p) => inGame(p, "import('./rules.js').then(({ solve }) => solve(document.getElementById('board').inspect().puzzle))");
/* Both look for a player; whoever joined reads the rules and accepts them. */
async function find(a, b) {
  await row(a, 'shikaku').getByText('Find a player').click();
  await choose(a);
  await a.page.waitForSelector('text=Looking for a player');
  await row(b, 'shikaku').getByText('Find a player').click();
  await choose(b);
  await accept(b);
  await Promise.all([a, b].map((p) => status(p, /^Playing$/)));
}
try {
  const [ann, bob] = [await open('Ann'), await open('Bob')];
  assert.ok(await ann.page.evaluate(() => [...document.querySelectorAll('.art')].every((i) => i.complete && i.naturalWidth)), 'the game pictures load');
  await shot(ann, 'library');

  await invite(ann, bob);
  assert.equal(await ann.page.textContent('#mode'), 'Direct connection');
  assert.equal(await bob.page.textContent('#mode'), 'Direct connection');
  assert.equal(await ann.page.textContent('#p0'), 'Ann (you)');
  assert.equal(await bob.page.textContent('#p0'), 'Ann');
  const rects = await solve(bob);
  await inGame(bob, drag([...rects.slice(0, 3), { r0: 5, c0: 4, r1: 5, c1: 5 }].filter((x, i, all) => i < 3 || !all.slice(0, 3).some((y) => y.r1 >= 5 && y.c1 >= 4))));
  await bob.page.waitForTimeout(350);
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

  // Tapping a block takes it away, so the board is cleared before every block is placed for good.
  await inGame(bob, "document.getElementById('clear').click()");
  await inGame(bob, drag(rects));
  await Promise.all([status(bob, /^You win\. \+16 points\.$/), status(ann, /^You lose\. .16 points\.$/)]);
  await bob.page.waitForTimeout(400);
  await shot(bob, 'won');
  for (const p of [ann, bob]) await p.page.click('#leave');
  await bob.page.waitForSelector('text=You won 1 and lost 0');
  await ann.page.waitForSelector('text=You won 0 and lost 1');

  // Hidden address: the match goes through the server.
  await bob.page.check('#hide');
  await invite(ann, bob);
  assert.deepEqual([await ann.page.textContent('#mode'), await bob.page.textContent('#mode')], ['Through the server', 'Through the server']);
  await bob.page.click('#leave');
  await Promise.all([status(bob, /^You gave up\./), status(ann, /gave up\./)]);
  for (const p of [ann, bob]) await p.page.click('#leave');

  // A player who disappears does not cost the other one a loss.
  await find(ann, bob);
  await bob.app.close();
  apps.pop();
  await status(ann, /connection was lost.*does not count/);
  await ann.page.click('#leave');
  await ann.page.waitForSelector('text=You won 1 and lost 1');

  // Games opened and closed quickly: the last one works. A game that floods the app is closed.
  const carl = await open('Carl');
  for (let i = 0; i < 4; i++) { await row(ann, 'shikaku').getByText('Find a player').click(); await choose(ann); await ann.page.click('#cancel'); }
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
  await row(ann, 'shikaku').locator('.join input').fill('AAAAAAAA');
  await row(ann, 'shikaku').locator('.join button').click();
  await ann.page.waitForSelector('text=There is no open match with that code');
  for (const width of [360, 768, 1080]) {
    await ann.app.evaluate(({ BrowserWindow }, w) => BrowserWindow.getAllWindows()[0].setContentSize(w, 760), width);
    await ann.page.waitForTimeout(150);
    assert.ok(await ann.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.getElementById('library').scrollWidth <= document.getElementById('library').clientWidth), `cut off at ${width}px`);
    await shot(ann, `library-${width}`);
  }
  await server.close();
  await row(ann, 'gemhold').getByText('Leaderboard').click();
  await ann.page.waitForSelector('text=The leaderboard cannot be reached');
  await ann.page.click('#boardBack');
  await row(ann, 'shikaku').getByText('Find a player').click();
  await choose(ann);
  await ann.page.waitForSelector('text=The match server cannot be reached');
  assert.deepEqual([...ann.errors, ...bob.errors].filter((e) => !/WebSocket|ERR_CONNECTION_REFUSED/.test(e)), []);
  console.log('APP OK: direct match, server match, lost player, wrong code, server off, game locked in');
} finally {
  await closeAll();
}
