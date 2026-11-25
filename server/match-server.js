/* Finds two players and introduces their computers. It knows no names, keeps no
   accounts and stores nothing. When the computers cannot reach each other
   directly, it passes their messages on. */
import { WebSocketServer } from 'ws';
import { randomInt } from 'node:crypto';

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LIMITS = { maxBytes: 26 * 1024, perSecond: 80, bytesPerSecond: 64 * 1024, buffered: 256 * 1024, perAddress: 20, opensPerMinute: 60,
  waitMs: 10 * 60 * 1000, pairMs: 4 * 60 * 60 * 1000, joinTries: 10, pingMs: 30 * 1000, minuteMs: 60 * 1000 };
const KEY = /^[a-z0-9-]{1,40}@[0-9a-f]{64}$/;         // game@hash: only equal versions meet

/* One home is one address: the first half of an IPv6 address, or the IPv4 address. */
export function addressKey(ip) {
  const v4 = /^(?:::ffff:)?(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (v4) return v4[1];
  const [head, tail] = String(ip).toLowerCase().split('%')[0].split('::');
  const left = head ? head.split(':') : [], right = tail ? tail.split(':') : [];
  const full = tail === undefined ? left : [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
  return full.slice(0, 4).map((x) => x.replace(/^0+(?=.)/, '')).join(':');
}

/* proxies: how many trusted proxies stand in front of this server. */
export function startMatchServer({ port = 0, host = '127.0.0.1', proxies = 0, limits = {} } = {}) {
  const L = { ...LIMITS, ...limits };
  const open = new Map();                              // code -> waiting player
  const queues = new Map();                            // game@hash -> waiting player
  const addresses = new Map();
  const wss = new WebSocketServer({ port, host, maxPayload: L.maxBytes, perMessageDeflate: false });
  // A player who does not read is cut off before the waiting messages fill the memory.
  const tell = (ws, msg) => {
    if (ws.readyState !== ws.OPEN) return;
    if (ws.bufferedAmount > L.buffered) { ws.terminate(); return; }
    ws.send(JSON.stringify(msg));
  };
  const addressOf = (req) => addressKey((proxies > 0 && String(req.headers['x-forwarded-for'] || '').split(',').at(-proxies)?.trim()) || req.socket.remoteAddress);
  const seen = (address) => {
    const now = Date.now(), old = addresses.get(address);
    const a = old ?? { count: 0, opens: 0, tries: 0, since: now };
    if (now - a.since > L.minuteMs) Object.assign(a, { opens: 0, tries: 0, since: now });
    addresses.set(address, a);
    return a;
  };

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
    const timer = setTimeout(() => { host.terminate(); guest.terminate(); }, L.pairMs);
    timer.unref();
    host.og.timer = guest.og.timer = timer;
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
      if (!host || host === ws || host.og.key !== msg.key) {
        tell(ws, { t: 'error', error: host && host !== ws ? 'other_version' : 'no_match' });
        if (++seen(ws.og.address).tries >= L.joinTries) ws.close(1008);
        return undefined;
      }
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
    ws.on('error', () => ws.terminate());                // first, so no bad frame can stop the server
    const address = addressOf(req), from = seen(address);
    if (from.count >= L.perAddress || ++from.opens > L.opensPerMinute || from.tries >= L.joinTries) { ws.terminate(); return; }
    from.count++;
    ws.og = { address, peer: null, code: null, queue: null, key: null, timer: null, alive: true };
    let second = 0, used = 0, bytes = 0;
    ws.on('pong', () => { ws.og.alive = true; });
    ws.on('message', (raw, binary) => {
      const now = Math.floor(Date.now() / 1000);
      if (now !== second) { second = now; used = 0; bytes = 0; }
      bytes += raw.length;
      if (binary || ++used > L.perSecond || bytes > L.bytesPerSecond) { ws.close(1008); return; }
      let msg;
      try { msg = JSON.parse(raw); } catch { ws.close(1007); return; }
      if (msg && Object.hasOwn(actions, msg.t)) actions[msg.t](ws, msg);
    });
    ws.on('close', () => {
      stopWaiting(ws);
      const { peer } = ws.og;
      if (peer) { peer.og.peer = null; ws.og.peer = null; tell(peer, { t: 'gone' }); }
      from.count--;
    });
  });
  const ping = setInterval(() => {
    for (const [key, a] of addresses) if (!a.count && Date.now() - a.since > L.minuteMs) addresses.delete(key);
    wss.clients.forEach((ws) => {
      if (!ws.og) return;
      if (!ws.og.alive) { ws.terminate(); return; }
      ws.og.alive = false; ws.ping();
    });
  }, L.pingMs);
  ping.unref();

  return new Promise((resolve, reject) => {
    wss.on('error', reject);                             // only before it listens; later errors are per player
    wss.once('listening', () => resolve({
      port: wss.address().port,
      counts: () => ({ open: open.size, queues: queues.size, clients: wss.clients.size, addresses: [...addresses.values()].filter((a) => a.count).length }),
      close: () => new Promise((done) => { clearInterval(ping); wss.clients.forEach((c) => c.terminate()); wss.close(done); }),
    }));
  });
}
