/* Tells a player's computer its own internet address (STUN, RFC 8489), so that two players can
   connect to each other directly. It answers binding requests only and keeps nothing. */
import { createSocket } from 'node:dgram';
import { isIPv4 } from 'node:net';

const COOKIE = 0x2112a442, REQUEST = 0x0001, SUCCESS = 0x0101, XOR_MAPPED = 0x0020, HEADER = 20;
const PER_SECOND = 20, MAX_ADDRESSES = 10_000;

const v6Bytes = (ip) => {
  const [head, tail] = ip.split('%')[0].split('::');
  const part = (s) => (s ? s.split(':').map((x) => parseInt(x, 16)) : []);
  const left = part(head), right = part(tail);
  const all = tail === undefined ? left : [...left, ...Array(8 - left.length - right.length).fill(0), ...right];
  return Buffer.from(all.flatMap((x) => [x >> 8, x & 255]));
};
const plain = (ip) => /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)?.[1] ?? ip;
/* So many answers a second to one address. When too many addresses ask, the newest are answered
   without being counted: forged ones must not keep a player waiting. */
export function createAllowance(maxAddresses = MAX_ADDRESSES) {
  let second = 0, used = new Map();
  return (address, now) => {
    if (now !== second) { second = now; used = new Map(); }
    const n = (used.get(address) ?? 0) + 1;
    if (n > 1 || used.size < maxAddresses) used.set(address, n);
    return n <= PER_SECOND;
  };
}
export function bindingAnswer(message, { address: from, port }) {
  const address = plain(from);
  if (message.length < HEADER || message.readUInt16BE(0) !== REQUEST || message.readUInt32BE(4) !== COOKIE || message.readUInt16BE(2) !== message.length - HEADER) return null;
  const isV4 = isIPv4(address), ip = isV4 ? Buffer.from(address.split('.').map(Number)) : v6Bytes(address);
  const mask = message.subarray(4, HEADER), body = Buffer.alloc(8 + ip.length), head = Buffer.alloc(HEADER);
  body.writeUInt16BE(XOR_MAPPED, 0); body.writeUInt16BE(4 + ip.length, 2);
  body[5] = isV4 ? 1 : 2;
  body.writeUInt16BE(port ^ (COOKIE >>> 16), 6);
  ip.forEach((byte, i) => { body[8 + i] = byte ^ mask[i]; });
  head.writeUInt16BE(SUCCESS, 0); head.writeUInt16BE(body.length, 2);
  mask.copy(head, 4);
  return Buffer.concat([head, body]);
}
export function startStun({ port = 3478, host = '0.0.0.0' } = {}) {
  const socket = createSocket(host.includes(':') ? 'udp6' : 'udp4');
  const allow = createAllowance();
  socket.on('message', (message, from) => {
    if (!allow(from.address, Math.floor(Date.now() / 1000))) return;
    const answer = bindingAnswer(message, from);
    if (answer) socket.send(answer, from.port, from.address, () => {});
  });
  return new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.bind(port, host, () => {
      socket.on('error', (error) => console.error('STUN:', error.message));
      resolve({ port: socket.address().port, close: () => new Promise((done) => socket.close(done)) });
    });
  });
}
