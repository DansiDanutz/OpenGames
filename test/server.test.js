import test from 'node:test';
import assert from 'node:assert/strict';
import { startMatchServer } from '../server/match-server.js';
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
