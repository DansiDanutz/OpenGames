/* Finds two players and introduces their computers. It knows no names, keeps no
   accounts and stores nothing. When the computers cannot reach each other
   directly, it passes their messages on. */
import { WebSocketServer } from 'ws';
import { randomInt } from 'node:crypto';

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LIMITS = { maxBytes: 32 * 1024, perSecond: 80, perAddress: 20, waitMs: 10 * 60 * 1000, joinTries: 10, pingMs: 30 * 1000 };
const KEY = /^[a-z0-9-]{1,40}@[0-9a-f]{64}$/;         // game@hash: only equal versions meet

export function startMatchServer({ port = 0, host = '127.0.0.1', trustProxy = false, limits = {} } = {}) {
  const L = { ...LIMITS, ...limits };
  const open = new Map();                              // code -> waiting player
  const queues = new Map();                            // game@hash -> waiting player
  const addresses = new Map();
  const wss = new WebSocketServer({ port, host, maxPayload: L.maxBytes, perMessageDeflate: false });
  const tell = (ws, msg) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); };
  const addressOf = (req) => (trustProxy && String(req.headers['x-forwarded-for'] || '').split(',').pop().trim()) || req.socket.remoteAddress;

  function newCode() {
    for (;;) {
      const code = Array.from({ length: 6 }, () => LETTERS[randomInt(LETTERS.length)]).join('');
      if (!open.has(code)) return code;
    }
  }
  function stopWaiting(ws) {
    clearTimeout(ws.og.timer);
    if (ws.og.code) open.delete(ws.og.code);
    if (ws.og.queue && queues.get(ws.og.queue) === ws) queues.delete(ws.og.queue);
    ws.og = { ...ws.og, code: null, queue: null, timer: null };
  }
  function wait(ws) {
    ws.og.timer = setTimeout(() => { stopWaiting(ws); tell(ws, { t: 'expired' }); }, L.waitMs);
    ws.og.timer.unref();
  }
  function pair(host, guest) {
    stopWaiting(host); stopWaiting(guest);
    host.og.peer = guest; guest.og.peer = host;
    tell(host, { t: 'paired', host: true });
    tell(guest, { t: 'paired', host: false });
  }
  const busy = (ws) => ws.og.peer || ws.og.code || ws.og.queue;

  const actions = {
    create(ws, msg) {
      if (busy(ws) || !KEY.test(msg.key)) return tell(ws, { t: 'error', error: 'bad_request' });
      ws.og.code = newCode(); ws.og.key = msg.key;
      open.set(ws.og.code, ws); wait(ws);
      return tell(ws, { t: 'code', code: ws.og.code });
    },
    join(ws, msg) {
      if (busy(ws) || !KEY.test(msg.key)) return tell(ws, { t: 'error', error: 'bad_request' });
      const host = open.get(String(msg.code || '').toUpperCase());
      if (!host || host === ws) {
        tell(ws, { t: 'error', error: 'no_match' });
        if (++ws.og.tries >= L.joinTries) ws.close(1008);
        return undefined;
      }
      if (host.og.key !== msg.key) return tell(ws, { t: 'error', error: 'other_version' });
      return pair(host, ws);
    },
    find(ws, msg) {
      if (busy(ws) || !KEY.test(msg.key)) return tell(ws, { t: 'error', error: 'bad_request' });
      const other = queues.get(msg.key);
      if (other) return pair(other, ws);
      ws.og.queue = msg.key; queues.set(msg.key, ws); wait(ws);
      return tell(ws, { t: 'searching' });
    },
    leave: (ws) => stopWaiting(ws),
    signal: (ws, msg) => ws.og.peer && tell(ws.og.peer, { t: 'signal', data: msg.data }),
    relay: (ws, msg) => ws.og.peer && tell(ws.og.peer, { t: 'relay', data: msg.data }),
  };

  wss.on('connection', (ws, req) => {
    const address = addressOf(req);
    const count = (addresses.get(address) || 0) + 1;
    if (count > L.perAddress) { ws.close(1013); return; }
    addresses.set(address, count);
    ws.og = { peer: null, code: null, queue: null, key: null, timer: null, tries: 0, alive: true };
    let second = 0, used = 0;
    ws.on('pong', () => { ws.og.alive = true; });
    ws.on('error', () => ws.terminate());
    ws.on('message', (raw, binary) => {
      const now = Math.floor(Date.now() / 1000);
      if (now !== second) { second = now; used = 0; }
      if (binary || ++used > L.perSecond) { ws.close(1008); return; }
      let msg;
      try { msg = JSON.parse(raw); } catch { ws.close(1007); return; }
      if (msg && Object.hasOwn(actions, msg.t)) actions[msg.t](ws, msg);
    });
    ws.on('close', () => {
      stopWaiting(ws);
      const { peer } = ws.og;
      if (peer) { peer.og.peer = null; ws.og.peer = null; tell(peer, { t: 'gone' }); }
      const left = addresses.get(address) - 1;
      if (left) addresses.set(address, left); else addresses.delete(address);
    });
  });
  const ping = setInterval(() => wss.clients.forEach((ws) => {
    if (!ws.og) return;
    if (!ws.og.alive) { ws.terminate(); return; }
    ws.og.alive = false; ws.ping();
  }), L.pingMs);
  ping.unref();

  return new Promise((resolve, reject) => {
    wss.once('error', reject);
    wss.once('listening', () => resolve({
      port: wss.address().port,
      counts: () => ({ open: open.size, queues: queues.size, clients: wss.clients.size, addresses: addresses.size }),
      close: () => new Promise((done) => { clearInterval(ping); wss.clients.forEach((c) => c.terminate()); wss.close(done); }),
    }));
  });
}
