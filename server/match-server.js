/* Finds two players and introduces their computers. Matchmaking keeps no accounts
   and stores nothing; only ranked results (leaderboard.js) and how often a game is played (stats.js) are kept. When the computers cannot reach each other
   directly, it passes their messages on. */
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { randomInt, randomUUID } from 'node:crypto';
import { createTickets, answerHttp } from './http.js';

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LIMITS = { maxBytes: 26 * 1024, perSecond: 80, bytesPerSecond: 64 * 1024, buffered: 256 * 1024, perAddress: 20, opensPerMinute: 60,
  waitMs: 10 * 60 * 1000, pairMs: 4 * 60 * 60 * 1000, joinTries: 10, invitesPerAddress: 20, pingMs: 30 * 1000, minuteMs: 60 * 1000,
  quietMs: 20 * 1000, resultsPerMinute: 10, readsPerMinute: 120, pagesPerMinute: 600, findsPerMinute: 30, bodyMs: 25_000, playedMs: 60 * 1000 };
const CODE_LENGTH = 8;
const BACK = /^[A-Z2-9]{8}\.[0-9a-f-]{36}$/;          // the code of an invite and its secret
const PUB = /^[0-9a-f]{64}$/;
const KEY = /^[a-z0-9-]{1,40}@[0-9a-f]{64}$/;         // game@hash: only equal versions meet

const is = (pattern, v) => typeof v === 'string' && pattern.test(v);

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
export function startMatchServer({ port = 0, host = '127.0.0.1', proxies = 0, limits = {}, leaderboard = null, stats = null, site = null } = {}) {
  const L = { ...LIMITS, ...limits };
  const open = new Map();                              // code -> { host, guest, key, back, address, timer }: an invite
  const queues = new Map();                            // game@hash -> waiting player
  const addresses = new Map();
  const tickets = createTickets(L.pairMs * 2);
  const http = createServer({ headersTimeout: 10_000, requestTimeout: 30_000 });
  const wss = new WebSocketServer({ server: http, maxPayload: L.maxBytes, perMessageDeflate: false });
  // A player who does not read is cut off before the waiting messages fill the memory.
  const tell = (ws, msg) => {
    if (ws.readyState !== ws.OPEN) return;
    if (ws.bufferedAmount > L.buffered) { ws.terminate(); return; }
    ws.send(JSON.stringify(msg));
  };
  const addressOf = (req) => addressKey((proxies > 0 && String(req.headers['x-forwarded-for'] || '').split(',').at(-proxies)?.trim()) || req.socket.remoteAddress);
  const seen = (address) => {
    const now = Date.now(), old = addresses.get(address);
    const a = old ?? { count: 0, invites: 0, opens: 0, tries: 0, results: 0, reads: 0, pages: 0, finds: 0, since: now };
    if (now - a.since > L.minuteMs) Object.assign(a, { opens: 0, tries: 0, results: 0, reads: 0, pages: 0, finds: 0, since: now });
    addresses.set(address, a);
    return a;
  };

  function newCode() {
    for (;;) {
      const code = Array.from({ length: CODE_LENGTH }, () => LETTERS[randomInt(LETTERS.length)]).join('');
      if (!open.has(code)) return code;
    }
  }
  function closeInvite(code) {
    const invite = open.get(code);
    if (!invite) return;
    clearTimeout(invite.timer);
    open.delete(code);
    seen(invite.address).invites -= 1;
  }
  /* An invite outlives its connection, because a phone that shows another app cuts it. `back` proves whose it is. */
  function returnTo(ws, back) {
    const [code] = back.split('.'), invite = open.get(code);
    if (invite?.back !== back) return tell(ws, { t: 'expired' });
    if (invite.host) { invite.host.og.code = null; invite.host.terminate(); }
    invite.host = ws;
    ws.og.code = code; ws.og.key = invite.key;
    tell(ws, { t: 'code', code, back });
    const { guest } = invite;
    return guest && pair(ws, guest, invite.key);
  }
  function stopWaiting(ws) {
    clearTimeout(ws.og.timer);
    if (ws.og.code) closeInvite(ws.og.code);
    if (ws.og.visiting && open.get(ws.og.visiting)?.guest === ws) open.get(ws.og.visiting).guest = null;
    if (ws.og.queue && queues.get(ws.og.queue) === ws) queues.delete(ws.og.queue);
    ws.og = { ...ws.og, code: null, visiting: null, queue: null, timer: null };
  }
  function wait(ws) {
    ws.og.timer = setTimeout(() => { stopWaiting(ws); tell(ws, { t: 'expired' }); }, L.waitMs);
    ws.og.timer.unref();
  }
  function pair(host, guest, key) {
    stopWaiting(host); stopWaiting(guest);
    const ticket = randomUUID(), pubs = [host.og.pub, guest.og.pub];
    const canRank = !!leaderboard && pubs.every((p) => p) && pubs[0] !== pubs[1] && (L.rankSameAddress || host.og.address !== guest.og.address);
    if (canRank) tickets.add(ticket, { key, pubs });
    host.og.peer = guest; guest.og.peer = host;
    const timer = setTimeout(() => { host.terminate(); guest.terminate(); }, L.pairMs);
    timer.unref();
    host.og.timer = guest.og.timer = timer;
    if (stats) {
      host.og.played = setTimeout(() => {
        try { stats.played(key, [host.og.address, guest.og.address]); } catch (error) { console.error('A match was not counted:', error.message); }
      }, L.playedMs);
      host.og.played.unref();
    }
    tell(host, { t: 'paired', host: true, ticket: canRank ? ticket : null, pub: canRank ? pubs[1] : null });
    tell(guest, { t: 'paired', host: false, ticket: canRank ? ticket : null, pub: canRank ? pubs[0] : null });
  }
  const busy = (ws) => ws.og.peer || ws.og.code || ws.og.visiting || ws.og.queue;

  const actions = {
    create(ws, msg) {
      if (busy(ws) || !is(KEY, msg.key)) return tell(ws, { t: 'error', error: 'bad_request' });
      if (is(BACK, msg.back)) return returnTo(ws, msg.back);
      const from = seen(ws.og.address);
      if (from.invites >= L.invitesPerAddress) return tell(ws, { t: 'error', error: 'too_many' });
      from.invites += 1;
      const code = newCode(), invite = { host: ws, guest: null, key: msg.key, back: `${code}.${randomUUID()}`, stays: msg.stays === true, address: ws.og.address };
      invite.timer = setTimeout(() => {
        for (const p of [invite.host, invite.guest]) if (p) { p.og.code = null; p.og.visiting = null; tell(p, { t: 'expired' }); }
        closeInvite(code);
      }, L.waitMs);
      invite.timer.unref();
      open.set(code, invite);
      ws.og.code = code; ws.og.key = msg.key;
      return tell(ws, { t: 'code', code, back: invite.back });
    },
    join(ws, msg) {
      if (busy(ws) || !is(KEY, msg.key)) return tell(ws, { t: 'error', error: 'bad_request' });
      const code = String(msg.code || '').toUpperCase(), invite = open.get(code);
      if (!invite || invite.key !== msg.key || invite.guest) {
        tell(ws, { t: 'error', error: 'no_match' });
        if (++seen(ws.og.address).tries >= L.joinTries) ws.close(1008);
        return undefined;
      }
      if (invite.host) return pair(invite.host, ws, msg.key);
      invite.guest = ws;
      ws.og.visiting = code;
      return tell(ws, { t: 'waiting' });
    },
    find(ws, msg) {
      if (busy(ws) || !is(KEY, msg.key)) return tell(ws, { t: 'error', error: 'bad_request' });
      // Nobody may meet everyone who looks for a player. Homes and phones share addresses, so the limit is wide.
      if (seen(ws.og.address).finds >= L.findsPerMinute) return tell(ws, { t: 'error', error: 'too_many' });
      const other = queues.get(msg.key);
      if (other) {
        for (const address of new Set([ws.og.address, other.og.address])) seen(address).finds += 1;
        return pair(other, ws, msg.key);
      }
      ws.og.queue = msg.key; queues.set(msg.key, ws); wait(ws);
      return tell(ws, { t: 'searching' });
    },
    leave: (ws) => {
      if (ws.og.peer) return;
      const guest = open.get(ws.og.code)?.guest;
      stopWaiting(ws);
      if (guest) { guest.og.visiting = null; tell(guest, { t: 'error', error: 'no_match' }); }
    },   // the pair's own time limit stays
    signal: (ws, msg) => ws.og.peer && tell(ws.og.peer, { t: 'signal', data: msg.data }),
    relay: (ws, msg) => ws.og.peer && tell(ws.og.peer, { t: 'relay', data: msg.data }),
  };

  wss.on('connection', (ws, req) => {
    ws.on('error', () => ws.terminate());                // first, so no bad frame can stop the server
    const address = addressOf(req), from = seen(address);
    if (from.count >= L.perAddress || ++from.opens > L.opensPerMinute || from.tries >= L.joinTries) { ws.terminate(); return; }
    from.count++;
    ws.og = { address, pub: null, peer: null, code: null, visiting: null, queue: null, key: null, timer: null, alive: true };
    ws.og.quiet = setTimeout(() => ws.terminate(), L.quietMs);   // somebody who only connects is not a player
    ws.og.quiet.unref();
    let second = 0, used = 0, bytes = 0;
    ws.on('pong', () => { ws.og.alive = true; });
    ws.on('message', (raw, binary) => {
      const now = Math.floor(Date.now() / 1000);
      if (now !== second) { second = now; used = 0; bytes = 0; }
      bytes += raw.length;
      if (binary || ++used > L.perSecond || bytes > L.bytesPerSecond) { ws.close(1008); return; }
      let msg;
      try { msg = JSON.parse(raw); } catch { ws.close(1007); return; }
      clearTimeout(ws.og.quiet);
      if (msg && is(PUB, msg.pub) && !ws.og.pub) ws.og.pub = msg.pub;       // whose ranked match this will be
      if (!msg || !Object.hasOwn(actions, msg.t)) return;
      // One player's message must never stop the server for the others.
      try { actions[msg.t](ws, msg); } catch (error) { console.error('A message failed:', error.message); ws.close(1011); }
    });
    ws.on('close', () => {
      clearTimeout(ws.og.quiet);
      const invite = ws.og.code && !ws.og.peer && open.get(ws.og.code);
      if (invite?.stays) { invite.host = null; ws.og.code = null; }   // an app that does not come back loses its invite at once
      stopWaiting(ws);
      const { peer } = ws.og;
      clearTimeout(ws.og.played); clearTimeout(peer?.og.played);
      if (peer) { peer.og.peer = null; ws.og.peer = null; tell(peer, { t: 'gone' }); }
      from.count--;
    });
  });
  http.on('request', (req, res) => answerHttp({ req, res, from: seen(addressOf(req)), limits: L, tickets, leaderboard, site }));
  const ping = setInterval(() => {
    tickets.sweep();
    for (const [key, a] of addresses) if (!a.count && !a.invites && Date.now() - a.since > L.minuteMs) addresses.delete(key);
    wss.clients.forEach((ws) => {
      if (!ws.og) return;
      if (!ws.og.alive) { ws.terminate(); return; }
      ws.og.alive = false; ws.ping();
    });
  }, L.pingMs);
  ping.unref();

  return new Promise((resolve, reject) => {
    wss.on('error', () => {});                           // the same errors as the server below
    http.once('error', reject);                          // only before it listens; later errors are per player
    http.listen(port, host, () => resolve({
      port: http.address().port,
      counts: () => ({ open: open.size, queues: queues.size, clients: wss.clients.size, addresses: [...addresses.values()].filter((a) => a.count).length }),
      close: () => new Promise((done) => { clearInterval(ping); wss.clients.forEach((c) => c.terminate()); wss.close(); http.close(done); http.closeAllConnections(); for (const x of open.values()) clearTimeout(x.timer); }),
    }));
  });
}
