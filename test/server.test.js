import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { addressKey, startMatchServer } from '../server/match-server.js';
import { meet, link } from '../app/shell/wire.js';
import { until } from './helpers.js';

const KEY = `shikaku@${'a'.repeat(64)}`, OTHER = `shikaku@${'b'.repeat(64)}`;
function client(port, ask, key = KEY) {
  const c = { log: [] };
  const on = Object.fromEntries(['code', 'searching', 'error', 'closed', 'paired'].map((k) => [k, (v) => { c[k] = v ?? true; c.log.push(k); }]));
  Object.assign(c, meet({ url: `ws://127.0.0.1:${port}`, key, ask, on }));
  return c;
}
const withServer = async (limits, run) => { const s = await startMatchServer({ limits }); try { await run(s); } finally { await s.close(); } };

test('a code joins two friends, and each code works once', () => withServer({}, async (s) => {
  const a = client(s.port, { t: 'create' });
  await until(() => a.code);
  assert.match(a.code.code, /^[A-HJ-NP-Z2-9]{6}$/);
  const b = client(s.port, { t: 'join', code: a.code.code.toLowerCase() });
  await until(() => a.paired && b.paired);
  assert.deepEqual([a.paired.host, b.paired.host], [true, false]);
  const c = client(s.port, { t: 'join', code: a.code.code });
  await until(() => c.error);
  assert.equal(c.error.error, 'no_match');
}));
test('finding a player pairs equal versions only', () => withServer({}, async (s) => {
  const a = client(s.port, { t: 'find' }), other = client(s.port, { t: 'find' }, OTHER);
  await until(() => a.searching && other.searching);
  const b = client(s.port, { t: 'find' });
  await until(() => a.paired && b.paired);
  assert.equal(other.paired, undefined);
  const code = client(s.port, { t: 'create' });
  await until(() => code.code);
  const wrong = client(s.port, { t: 'join', code: code.code.code }, OTHER);
  await until(() => wrong.error);
  assert.equal(wrong.error.error, 'other_version');
}));
test('leaving frees the code and the queue, and nothing is kept', () => withServer({}, async (s) => {
  const a = client(s.port, { t: 'create' }), b = client(s.port, { t: 'find' });
  await until(() => a.code && b.searching);
  a.cancel(); b.cancel();
  await until(() => s.counts().clients === 0);
  assert.deepEqual(s.counts(), { open: 0, queues: 0, clients: 0, addresses: 0 });
}));
test('waiting ends after the time limit', () => withServer({ waitMs: 60 }, async (s) => {
  const a = client(s.port, { t: 'find' });
  await until(() => a.closed);
  assert.equal(a.closed, 'expired');
}));
test('too many connections, messages, bytes or wrong codes are cut off', async () => {
  await withServer({ perAddress: 2 }, async (s) => {
    const all = [1, 2, 3].map(() => client(s.port, { t: 'create' }));
    await until(() => all.some((c) => c.closed));
    assert.equal(all.filter((c) => c.code).length, 2);
  });
  const raw = async (s, send) => {
    const ws = new WebSocket(`ws://127.0.0.1:${s.port}`);
    let closed = null;
    ws.onclose = (e) => { closed = e.code; };
    await until(() => ws.readyState === 1);
    send(ws);
    await until(() => closed !== null);
    return closed;
  };
  await withServer({ perSecond: 10, joinTries: 3 }, async (s) => {
    assert.equal(await raw(s, (ws) => { for (let i = 0; i < 20; i++) ws.send('{"t":"x"}'); }), 1008);
    assert.equal(await raw(s, (ws) => ws.send('x'.repeat(40000))), 1009);
    assert.equal(await raw(s, (ws) => ws.send('not json')), 1007);
    assert.equal(await raw(s, (ws) => { for (let i = 0; i < 3; i++) ws.send(JSON.stringify({ t: 'join', key: KEY, code: 'AAAAAA' })); }), 1008);
  });
});
test('odd requests are ignored or refused without stopping the server', () => withServer({}, async (s) => {
  for (const ask of [{ t: 'constructor' }, { t: '__proto__' }, { t: 'relay', data: 1 }, { t: 'signal' }, { t: 'leave' }]) client(s.port, ask);
  const bad = client(s.port, { t: 'find' }, 'nonsense');
  await until(() => bad.error);
  const ok = client(s.port, { t: 'find' });
  await until(() => ok.searching);
}));
test('messages pass through the server when there is no direct connection, and the other player learns of a loss', () => withServer({}, async (s) => {
  const a = client(s.port, { t: 'find' });
  await until(() => a.searching);
  const b = client(s.port, { t: 'find' });
  await until(() => a.paired && b.paired);
  const [wa, wb] = await Promise.all([a, b].map((c) => link(c.paired, { Connection: null })));
  assert.deepEqual([wa.mode, wb.mode], ['relay', 'relay']);
  const got = [];
  wb.onMessage = (m) => got.push(m);
  wa.send({ n: 1 }); wa.send({ n: 2 }); wa.send({ big: 'x'.repeat(30000) });
  await until(() => got.length === 2);
  let lost = false;
  wb.onClose = () => { lost = true; };
  wa.close();
  await until(() => lost);
}));
test('a server that is off is reported', async () => {
  const s = await startMatchServer();
  await s.close();
  const a = client(s.port, { t: 'find' });
  await until(() => a.closed);
  assert.equal(a.closed, 'offline');
});
test('a bad frame from a refused connection does not stop the server', () => withServer({ perAddress: 1 }, async (s) => {
  const first = client(s.port, { t: 'find' });
  await until(() => first.searching);
  for (let i = 0; i < 3; i++) {
    const raw = net.connect(s.port, '127.0.0.1');
    raw.on('error', () => {});
    raw.write('GET / HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n');
    raw.write(Buffer.from([0xff, 0xff, 0, 0, 0, 0]));
    await new Promise((r) => { raw.on('close', r); setTimeout(r, 100); });
  }
  first.cancel();
  await until(() => s.counts().addresses === 0);
  const next = client(s.port, { t: 'find' });
  await until(() => next.searching);
}));
test('too many bytes, too many new connections and wrong codes over new connections are cut off', async () => {
  await withServer({ bytesPerSecond: 5000 }, async (s) => {
    const a = client(s.port, { t: 'find' });
    await until(() => a.searching);
    const b = client(s.port, { t: 'find' });
    await until(() => a.paired && b.paired);
    const [wa, wb] = await Promise.all([a, b].map((c) => link(c.paired, { Connection: null })));
    let lost = false;
    wb.onClose = () => { lost = true; };
    wb.onMessage = () => {};
    wa.onClose = () => {};
    for (let i = 0; i < 4; i++) wa.send({ x: 'y'.repeat(2000) });
    await until(() => lost);
  });
  await withServer({ opensPerMinute: 3 }, async (s) => {
    const all = [1, 2, 3, 4].map(() => client(s.port, { t: 'create' }));
    await until(() => all.some((c) => c.closed));
  });
  await withServer({ joinTries: 2 }, async (s) => {
    for (const code of ['AAAAAA', 'BBBBBB']) { const c = client(s.port, { t: 'join', code }); await until(() => c.error); c.cancel(); }
    const c = client(s.port, { t: 'join', code: 'CCCCCC' });
    await until(() => c.closed);
  });
});
test('a player who does not read is cut off', () => withServer({ buffered: -1 }, async (s) => {
  const a = client(s.port, { t: 'find' });
  await until(() => a.closed);
}));
test('one IPv6 home counts as one address', () => {
  assert.equal(addressKey('2001:db8:1:2:aaaa::1'), addressKey('2001:db8:1:2:bbbb:1:2:3'));
  assert.notEqual(addressKey('2001:db8:1:2::1'), addressKey('2001:db8:1:3::1'));
  assert.equal(addressKey('::ffff:192.0.2.7'), '192.0.2.7');
  assert.equal(addressKey('2001:0db8::1'), addressKey('2001:db8:0:0::2'));
});
test('a host cannot open several connections or claim a direct one that does not exist', async () => {
  const made = [];
  class Connection { constructor() { made.push(this); } async setRemoteDescription() { this.remoteDescription = {}; } async setLocalDescription() { this.localDescription = { toJSON: () => ({}) }; } async addIceCandidate() {} close() {} }
  const start = (options) => {
    const met = { host: false, peer: {}, send: () => {}, close: () => {} };
    const out = link(met, { Connection, ...options });
    out.catch(() => {});
    return { met, out };
  };
  const one = start({});
  for (let i = 0; i < 5; i++) one.met.peer.signal({ offer: {} });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(made.length, 1);
  one.met.peer.lost();
  const hidden = start({ hideAddress: true });
  hidden.met.peer.signal({ mode: 'direct' });
  await assert.rejects(hidden.out, /left/);
  assert.equal(made.length, 1);
});
