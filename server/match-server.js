/* Finds two players and introduces their computers. Matchmaking keeps no accounts
   and stores nothing; only ranked results (leaderboard.js) and how often a game is played (stats.js) are kept. When the computers cannot reach each other
   directly, it passes their messages on. */
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { randomInt, randomUUID } from 'node:crypto';
import { createTickets, answerHttp } from './http.js';

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LIMITS = { maxBytes: 26 * 1024, perSecond: 80, bytesPerSecond: 64 * 1024, buffered: 256 * 1024, perAddress: 20, opensPerMinute: 60,
  waitMs: 60 * 60 * 1000, findMs: 10 * 60 * 1000, awayMs: 10 * 60 * 1000, seatMs: 60 * 1000, roomMs: 12 * 60 * 60 * 1000, pairMs: 4 * 60 * 60 * 1000, joinTries: 10, invitesPerAddress: 20, pingMs: 30 * 1000, minuteMs: 60 * 1000,
  quietMs: 20 * 1000, resultsPerMinute: 10, readsPerMinute: 120, pagesPerMinute: 600, findsPerMinute: 30, bodyMs: 25_000, playedMs: 60 * 1000 };
const CODE_LENGTH = 8;
const BACK = /^[A-Z2-9]{8}\.[0-9a-f-]{36}$/;          // the code of a room and the secret of a seat
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
  const rooms = new Map();                             // code -> room
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
      if (!rooms.has(code)) return code;
    }
  }
  /* A room holds two players for as many matches as they like, and outlives their connections: a phone that shows
     another app cuts its own. `back` proves whose seat it is. */
  const emptySeat = () => ({ ws: null, back: null, pub: null, address: null, wants: null, timer: null });
  function openRoom(ws, key) {
    const code = newCode();
    const room = { code, key, seats: [emptySeat(), emptySeat()], epoch: 0, born: Date.now(), ticket: null, address: ws.og.address, timer: null, away: null, played: null };
    rooms.set(code, room);
    seen(room.address).invites += 1;
    expire(room, L.waitMs);
    sit(room, 0, ws);
    return room;
  }
  function sit(room, i, ws) {
    const seat = room.seats[i];
    if (seat.ws && seat.ws !== ws) { seat.ws.og.room = null; seat.ws.terminate(); }
    Object.assign(seat, { ws, back: seat.back ?? `${room.code}.${randomUUID()}`, pub: seat.pub ?? ws.og.pub, address: ws.og.address, wants: null });
    ws.og.room = room; ws.og.seat = i;
    clearTimeout(room.away); clearTimeout(seat.timer);
    tell(ws, { t: 'seat', back: seat.back, code: room.epoch ? null : room.code, host: i === 0, epoch: room.epoch });
  }
  /* A friend who never met the host makes room for another. */
  function freeSeat(room) {
    const { ws } = room.seats[1];
    if (ws) ws.og.room = null;
    if (ws) hush(ws);
    room.seats[1] = emptySeat();
  }
  function expire(room, ms) {
    clearTimeout(room.timer);
    room.timer = setTimeout(() => closeRoom(room, 'expired'), ms);
    room.timer.unref();
  }
  /* Whoever is in no room and no queue has nothing to do here. */
  function hush(ws) {
    clearTimeout(ws.og.quiet);
    ws.og.quiet = setTimeout(() => ws.terminate(), L.quietMs);
    ws.og.quiet.unref();
  }
  const timersOf = (room) => [room.timer, room.away, room.played, room.seats[1].timer];
  function closeRoom(room, why) {
    if (rooms.get(room.code) !== room) return;
    for (const timer of timersOf(room)) clearTimeout(timer);
    rooms.delete(room.code);
    seen(room.address).invites -= 1;
    for (const { ws } of room.seats) if (ws) { ws.og.room = null; tell(ws, { t: why }); hush(ws); }
  }
  /* Tells both players to connect to each other: for a new match, or again for the one they are playing. */
  function introduce(room, isNew) {
    const [a, b] = room.seats;
    room.epoch += 1;
    a.wants = b.wants = null;
    expire(room, Math.min(L.pairMs, room.born + L.roomMs - Date.now()));
    if (isNew) {
      const canRank = !!leaderboard && !!a.pub && !!b.pub && a.pub !== b.pub && (L.rankSameAddress || a.address !== b.address);
      room.ticket = canRank ? randomUUID() : null;
      if (canRank) tickets.add(room.ticket, { key: room.key, pubs: [a.pub, b.pub] });
      clearTimeout(room.played);
      if (stats) {
        const homes = [a.address, b.address];
        room.played = setTimeout(() => { try { stats.played(room.key, homes); } catch (error) { console.error('A match was not counted:', error.message); } }, L.playedMs);
        room.played.unref();
      }
    }
    room.seats.forEach(({ ws }, i) => tell(ws, { t: 'paired', host: i === 0, epoch: room.epoch, ticket: room.ticket, pub: room.ticket ? room.seats[1 - i].pub : null }));
  }
  function stopWaiting(ws) {
    clearTimeout(ws.og.timer);
    if (ws.og.queue && queues.get(ws.og.queue) === ws) queues.delete(ws.og.queue);
    ws.og.queue = ws.og.timer = null;
  }
  const other = (ws) => ws.og.room?.seats[1 - ws.og.seat];
  const bad = (ws) => tell(ws, { t: 'error', error: 'bad_request' });
  const isBusy = (ws, msg) => ws.og.room || ws.og.queue || !is(KEY, msg.key);
  /* What one player wants happens when the other wants it too. */
  function want(ws, msg, what, isNew) {
    const { room } = ws.og, peer = other(ws);
    if (!room?.epoch || msg.epoch !== room.epoch) return;  // asked before the two were introduced again
    room.seats[ws.og.seat].wants = what;
    if (peer.ws && peer.wants === what) introduce(room, isNew);
    else if (peer.ws) tell(peer.ws, { t: what });
  }

  const actions = {
    create(ws, msg) {
      if (isBusy(ws, msg)) return bad(ws);
      if (seen(ws.og.address).invites >= L.invitesPerAddress) return tell(ws, { t: 'error', error: 'too_many' });
      return openRoom(ws, msg.key);
    },
    back(ws, msg) {
      if (isBusy(ws, msg) || !is(BACK, msg.back)) return bad(ws);
      const room = rooms.get(msg.back.split('.')[0]), i = room?.key === msg.key ? room.seats.findIndex((s) => s.back === msg.back) : -1;
      if (i < 0) {
        tell(ws, { t: 'expired' });
        if (++seen(ws.og.address).tries >= L.joinTries) ws.close(1008);
        return undefined;
      }
      const had = room.seats[1 - i].wants;
      sit(room, i, ws);
      const peer = other(ws);
      if (!room.epoch) return peer.ws ? introduce(room, true) : i === 1 && tell(ws, { t: 'waiting' });
      if (peer.ws) tell(peer.ws, { t: 'here' }); else tell(ws, { t: 'away' });
      return had && tell(ws, { t: had });
    },
    join(ws, msg) {
      if (isBusy(ws, msg)) return bad(ws);
      const room = rooms.get(String(msg.code || '').toUpperCase());
      if (!room || room.key !== msg.key || room.seats[1].back) {
        tell(ws, { t: 'error', error: 'no_match' });
        if (++seen(ws.og.address).tries >= L.joinTries) ws.close(1008);
        return undefined;
      }
      sit(room, 1, ws);
      return room.seats[0].ws ? introduce(room, true) : tell(ws, { t: 'waiting' });
    },
    find(ws, msg) {
      if (isBusy(ws, msg)) return bad(ws);
      // Nobody may meet everyone who looks for a player. Homes and phones share addresses, so the limit is wide.
      if (seen(ws.og.address).finds >= L.findsPerMinute) return tell(ws, { t: 'error', error: 'too_many' });
      const first = queues.get(msg.key);
      if (first) {
        for (const address of new Set([ws.og.address, first.og.address])) seen(address).finds += 1;
        stopWaiting(first);
        const room = openRoom(first, msg.key);
        sit(room, 1, ws);
        return introduce(room, true);
      }
      ws.og.queue = msg.key; queues.set(msg.key, ws);
      ws.og.timer = setTimeout(() => { stopWaiting(ws); tell(ws, { t: 'expired' }); }, L.findMs);
      ws.og.timer.unref();
      return tell(ws, { t: 'searching' });
    },
    link: (ws, msg) => want(ws, msg, 'link', false),
    again: (ws, msg) => want(ws, msg, 'again', true),
    leave(ws) {
      stopWaiting(ws);
      hush(ws);
      const { room } = ws.og;
      if (!room) return;
      if (!room.epoch && ws.og.seat === 1) { freeSeat(room); return; }
      room.seats[ws.og.seat].ws = null;
      ws.og.room = null;
      closeRoom(room, room.epoch ? 'left' : 'expired');
    },
    signal: (ws, msg) => pass(ws, msg, 'signal'),
    relay: (ws, msg) => pass(ws, msg, 'relay'),
  };
  /* Nothing of an earlier connection reaches a later one. */
  function pass(ws, msg, t) {
    const { room } = ws.og, to = other(ws)?.ws;
    if (to && room.epoch && msg.epoch === room.epoch) tell(to, { t, epoch: room.epoch, data: msg.data });
  }
  function lost(ws) {
    stopWaiting(ws);
    const { room, seat } = ws.og;
    if (!room || room.seats[seat].ws !== ws) return;
    const peer = other(ws);
    Object.assign(room.seats[seat], { ws: null, wants: null });
    if (!room.epoch && seat === 1) {
      room.seats[1].timer = setTimeout(() => freeSeat(room), L.seatMs);
      room.seats[1].timer.unref();
    }
    if (peer.ws) { if (room.epoch) tell(peer.ws, { t: 'away' }); return; }
    clearTimeout(room.away);
    room.away = setTimeout(() => closeRoom(room, 'expired'), L.awayMs);
    room.away.unref();
  }

  wss.on('connection', (ws, req) => {
    ws.on('error', () => ws.terminate());                // first, so no bad frame can stop the server
    const address = addressOf(req), from = seen(address);
    if (from.count >= L.perAddress || ++from.opens > L.opensPerMinute || from.tries >= L.joinTries) { ws.terminate(); return; }
    from.count++;
    ws.og = { address, pub: null, room: null, seat: 0, queue: null, timer: null, quiet: null, alive: true };
    hush(ws);                                            // somebody who only connects is not a player
    let second = 0, used = 0, bytes = 0;
    ws.on('pong', () => { ws.og.alive = true; });
    ws.on('message', (raw, binary) => {
      const now = Math.floor(Date.now() / 1000);
      if (now !== second) { second = now; used = 0; bytes = 0; }
      bytes += raw.length;
      if (binary || ++used > L.perSecond || bytes > L.bytesPerSecond) { ws.close(1008); return; }
      let msg;
      try { msg = JSON.parse(raw); } catch { ws.close(1007); return; }
      if (msg && is(PUB, msg.pub) && !ws.og.pub) ws.og.pub = msg.pub;       // whose ranked match this will be
      if (!msg || !Object.hasOwn(actions, msg.t)) return;
      // One player's message must never stop the server for the others.
      try { actions[msg.t](ws, msg); if (ws.og.room || ws.og.queue) clearTimeout(ws.og.quiet); } catch (error) { console.error('A message failed:', error.message); ws.close(1011); }
    });
    ws.on('close', () => {
      clearTimeout(ws.og.quiet);
      lost(ws);
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
      counts: () => ({ open: rooms.size, queues: queues.size, clients: wss.clients.size, addresses: [...addresses.values()].filter((a) => a.count).length }),
      close: () => new Promise((done) => { clearInterval(ping); wss.clients.forEach((c) => c.terminate()); wss.close(); http.close(done); http.closeAllConnections(); for (const x of rooms.values()) timersOf(x).forEach(clearTimeout); }),
    }));
  });
}
