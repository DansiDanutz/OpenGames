import test from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { cleanDescription, isPlayerAddress } from '../app/shell/wire.js';
import { bindingAnswer, startStun } from '../server/stun.js';
import { startMatchServer } from '../server/match-server.js';
import { until } from './helpers.js';

const candidate = (ip, { port = 50000, proto = 'udp', typ = 'host' } = {}) => ({ candidate: `candidate:1 1 ${proto} 2113937151 ${ip} ${port} typ ${typ} generation 0` });
test('only addresses a player can have are tried', () => {
  for (const ok of ['192.168.1.4', '10.0.0.9', '203.0.113.7', '2001:db8::5', 'fe80::1', '01234567-89ab-cdef-0123-456789abcdef.local']) assert.equal(isPlayerAddress(candidate(ok)), true, ok);
  for (const no of ['127.0.0.1', '0.0.0.0', '239.1.1.1', '255.255.255.255', '::1', 'ff02::1', '::ffff:127.0.0.1', 'example.com', 'printer.local']) assert.equal(isPlayerAddress(candidate(no)), false, no);
  for (const odd of [candidate('10.0.0.9', { port: 53 }), candidate('10.0.0.9', { port: 99999 }), candidate('10.0.0.9', { proto: 'tcp' }), candidate('10.0.0.9', { typ: 'relay' }), null, {}, { candidate: 5 }, { candidate: 'x'.repeat(999) }]) assert.equal(isPlayerAddress(odd), false);
  assert.equal(isPlayerAddress({ candidate: '' }), true);
});
test('a description opens one data channel and carries no addresses', () => {
  const sdp = 'v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\na=candidate:1 1 udp 1 127.0.0.1 5000 typ host\r\na=mid:0\r\n';
  assert.deepEqual(cleanDescription({ type: 'offer', sdp }, 'offer'), { type: 'offer', sdp: 'v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\na=mid:0\r\n' });
  for (const bad of [null, {}, { type: 'answer', sdp }, { type: 'offer', sdp: `${sdp}m=audio 9 x 0\r\n` }, { type: 'offer', sdp: 'v=0\r\n' }, { type: 'offer', sdp: 'm=application 9 '.padEnd(9000, 'x') }]) assert.throws(() => cleanDescription(bad, 'offer'));
});
const request = () => { const m = Buffer.alloc(20); m.writeUInt16BE(1, 0); m.writeUInt32BE(0x2112a442, 4); m.fill(7, 8); return m; };
test('STUN tells a computer its own address', async () => {
  const stun = await startStun({ port: 0, host: '127.0.0.1' }), socket = dgram.createSocket('udp4');
  try {
    const answer = await new Promise((resolve) => { socket.once('message', resolve); socket.send(request(), stun.port, '127.0.0.1'); });
    assert.equal(answer.readUInt16BE(0), 0x0101);
    assert.equal(answer.readUInt16BE(26) ^ 0x2112, socket.address().port);
    assert.deepEqual([...answer.subarray(28, 32)].map((b, i) => b ^ [0x21, 0x12, 0xa4, 0x42][i]), [127, 0, 0, 1]);
  } finally { socket.close(); await stun.close(); }
});
test('STUN answers nothing else', () => {
  const from = { address: '2001:db8::1', port: 9 }, bad = request();
  bad.writeUInt16BE(3, 0);
  assert.equal(bindingAnswer(bad, from), null);
  assert.equal(bindingAnswer(Buffer.alloc(4), from), null);
  assert.equal(bindingAnswer(Buffer.concat([request(), Buffer.alloc(40)]), from), null);
  assert.equal(bindingAnswer(request(), from).length, 44);
});
const KEY = `shikaku@${'a'.repeat(64)}`;
const connect = (s, log) => new Promise((resolve) => { const ws = new WebSocket(`ws://127.0.0.1:${s.port}`); ws.onmessage = ({ data }) => log.push(JSON.parse(data).t); ws.onclose = () => log.push('closed'); ws.onopen = () => resolve(ws); });
test('leaving cannot lift the time limit of a pair', async () => {
  const s = await startMatchServer({ limits: { pairMs: 250 } }), logs = [[], []];
  try {
    const all = [await connect(s, logs[0]), await connect(s, logs[1])];
    all[0].send(JSON.stringify({ t: 'find', key: KEY }));
    await until(() => logs[0].includes('searching'));
    all[1].send(JSON.stringify({ t: 'find', key: KEY }));
    await until(() => logs.every((l) => l.includes('paired')));
    for (const ws of all) ws.send(JSON.stringify({ t: 'leave' }));
    await until(() => logs.every((l) => l.includes('closed')));
  } finally { await s.close(); }
});
test('somebody who connects and says nothing is cut off', async () => {
  const s = await startMatchServer({ limits: { quietMs: 60 } }), log = [];
  try { await connect(s, log); await until(() => log.includes('closed')); } finally { await s.close(); }
});
