/* Connects two players. The match server introduces them; then they try a
   direct connection. When that fails, or a player hides their address, the
   match server passes the messages on. */
const DIRECT_MS = 3000;
const AGAIN_MS = 1500, BEAT_MS = 4000, QUIET_MS = 14_000;
const MAX_TEXT = 24 * 1024;

const MAX_SDP = 8 * 1024, MAX_CANDIDATES = 30;

/* The other computer's addresses are only used when they look like a player's: UDP, no low port, and
   nothing on this computer itself. */
const isOwnOrSpecial = (ip) => /^(0\.|127\.|22[4-9]\.|23\d\.|24\d\.|25[0-5]\.)/.test(ip) || /^(::1?$|ff|::ffff:)/i.test(ip);
export function isPlayerAddress(candidate) {
  const line = candidate?.candidate;
  if (line === '') return true;                          // the end of the list
  const m = typeof line === 'string' && line.length <= 400
    && /^candidate:[\w+/]{1,32} \d{1,5} udp \d{1,10} (\S{2,60}) (\d{1,5}) typ (host|srflx|prflx)( |$)/i.exec(line);
  if (!m) return false;
  const [, ip, port] = m;
  if (Number(port) < 1024 || Number(port) > 65535) return false;
  if (/^[0-9a-f-]{36}\.local$/i.test(ip)) return true;
  const isV4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(ip), isV6 = /^[0-9a-f:]+$/i.test(ip) && ip.includes(':');
  return (isV4 || isV6) && !isOwnOrSpecial(ip);
}
/* A description may only open one data channel. Addresses in it are left out; they come one by one. */
export function cleanDescription(d, type) {
  if (d?.type !== type || typeof d.sdp !== 'string' || d.sdp.length > MAX_SDP) throw new Error('bad description');
  const lines = d.sdp.split(/\r?\n/).filter((x) => x && !x.startsWith('a=candidate'));
  const media = lines.filter((x) => x.startsWith('m='));
  if (media.length !== 1 || !media[0].startsWith('m=application ')) throw new Error('bad description');
  return { type, sdp: `${lines.join('\r\n')}\r\n` };
}

const parse = (text) => {
  if (typeof text !== 'string' || text.length > MAX_TEXT) return undefined;
  try { return JSON.parse(text); } catch { return undefined; }
};

/* The line to the match server, for a whole room: it comes back by itself when a phone has cut it. `on` gets code,
   seat, searching, waiting, paired, away, here, link, again, left, error, closed. */
const PASSED = ['searching', 'waiting', 'error', 'away', 'here', 'link', 'again'];
export function meet({ url, key, ask, on, Socket = globalThis.WebSocket, againMs = AGAIN_MS, page = globalThis.document }) {
  let ws, ended = false, peer = null, epoch = 0, back = ask.back ?? null, soon = null;
  const say = (msg) => { if (ws?.readyState === 1) ws.send(JSON.stringify(msg)); };
  const end = (reason) => { if (ended) return; ended = true; clearTimeout(soon); page?.removeEventListener?.('visibilitychange', wake); peer?.lost(); if (ws.readyState < 2) ws.close(); on.closed?.(reason); };
  const cut = () => {
    if (ended) return;
    peer?.lost();
    if (!back) { end('offline'); return; }
    on.cut?.();
    clearTimeout(soon);
    soon = setTimeout(connect, againMs);
    soon.unref?.();
  };
  const receive = ({ data }) => {
    const msg = parse(data);
    if (!msg || ended) return;
    if (msg.t === 'seat' && typeof msg.back === 'string') {
      back = msg.back;
      if (typeof msg.code === 'string' && msg.host === true) on.code?.({ code: msg.code });
      if (Number.isInteger(msg.epoch)) epoch = msg.epoch;
      on.seat?.({ back, host: msg.host === true, met: epoch > 0 });
    } else if (PASSED.includes(msg.t)) { if (msg.t === 'away') peer?.lost(); on[msg.t]?.(msg); }
    else if (msg.t === 'expired' || msg.t === 'left') end(msg.t);
    else if (msg.t === 'paired' && Number.isInteger(msg.epoch)) {
      const own = epoch = msg.epoch;
      peer?.lost();
      peer = { signal: () => {}, relay: () => {}, lost: () => {} };
      on.paired({ host: msg.host === true, ticket: typeof msg.ticket === 'string' ? msg.ticket : null, theirPub: typeof msg.pub === 'string' ? msg.pub : null, peer,
        send: (out) => { if (own === epoch) say({ ...out, epoch: own }); } });
    } else if (msg.epoch === epoch && (msg.t === 'signal' || msg.t === 'relay')) peer?.[msg.t](msg.data);
  };
  function connect() {
    if (ended) return;
    clearTimeout(soon);
    const mine = new Socket(url);
    ws = mine;
    let isCut = false;
    const lost = () => { if (isCut || ws !== mine) return; isCut = true; cut(); };
    mine.onopen = () => say(back ? { t: 'back', key, back, pub: ask.pub } : { ...ask, key });
    mine.onerror = lost;
    mine.onclose = lost;
    mine.onmessage = (event) => { if (ws === mine) receive(event); };
  }
  /* Whoever looks at the page again should not wait. */
  function wake() { if (!ended && !page.hidden && back && ws.readyState > 1) connect(); }
  page?.addEventListener?.('visibilitychange', wake);
  connect();
  return {
    link: () => say({ t: 'link', epoch }),
    again: () => say({ t: 'again', epoch }),
    isOpen: () => !ended && ws.readyState === 1,
    /* Leaves the room for good, also when the connection is just being cut. */
    cancel() {
      if (ended) return;
      ended = true;
      clearTimeout(soon);
      page?.removeEventListener?.('visibilitychange', wake);
      if (ws.readyState === 1 || !back) { say({ t: 'leave' }); ws.close(); return; }
      ws.close();
      const last = new Socket(url);
      last.onerror = () => {};
      last.onopen = () => { for (const msg of [{ t: 'back', key, back }, { t: 'leave' }]) last.send(JSON.stringify(msg)); last.close(); };
    },
  };
}

/* Resolves to { mode: 'direct' | 'relay', theirs, send, close, onMessage, onClose }. `have` is the match this side is in the
   middle of, `theirs` the other side's. */
export function link({ host, peer, send }, { have = null, hideAddress = false, iceServers = [], directMs = DIRECT_MS, beatMs = BEAT_MS, quietMs = QUIET_MS, Connection = globalThis.RTCPeerConnection } = {}) {
  return new Promise((resolve, reject) => {
    const direct = !hideAddress && !!Connection;
    let pc = null, channel = null, mode = null, settled = false, shut = false, timer = null, candidates = 0, beat = null, heard = 0, ticked = 0, isReady = false;
    const inbox = [];
    const wire = {
      mode: null, onClose: () => {},
      send(msg) {
        const text = JSON.stringify(msg);
        if (shut || text.length > MAX_TEXT) return;
        if (mode === 'direct') { if (channel.readyState === 'open') channel.send(text); } else send({ t: 'relay', data: msg });
      },
      close() { if (shut) return; shut = true; clearTimeout(timer); clearInterval(beat); channel?.close(); pc?.close(); },
      set onMessage(fn) { pass = fn; inbox.splice(0).forEach(fn); },
    };
    const deliver = (msg) => {
      heard = Date.now();
      if (msg?.t === 'have' && theirs === undefined) { theirs = typeof msg.match === 'string' ? msg.match : null; if (settled) begin(); } else if (msg?.t !== 'beat') pass(msg);
    };
    let pass = (msg) => { if (inbox.length < 64) inbox.push(msg); };
    const lost = () => { if (shut) return; wire.close(); if (isReady) wire.onClose(); else reject(new Error('The other player left.')); };
    const settle = () => { if (settled || shut) return; settled = true; clearTimeout(timer); wire.mode = mode; listenForSilence(); wire.send({ t: 'have', match: have }); if (theirs !== undefined) begin(); };
    let theirs;
    const begin = () => { isReady = true; wire.theirs = theirs; resolve(wire); };
    /* A line that died without a word. After a sleep of this device the count starts again. */
    const listenForSilence = () => {
      heard = ticked = Date.now();
      beat = setInterval(() => {
        const now = Date.now();
        if (now - ticked > beatMs * 3) heard = now;
        ticked = now;
        if (now - heard > quietMs) lost(); else wire.send({ t: 'beat' });
      }, beatMs);
      beat.unref?.();
    };
    const choose = (m) => {                              // only the host chooses
      if (mode) return;
      mode = m;
      send({ t: 'signal', data: { mode: m } });
      settle();
    };
    const listen = (ch) => {
      channel = ch;
      ch.onmessage = ({ data }) => { const msg = parse(data); if (msg !== undefined && !shut) deliver(msg); };
      ch.onopen = () => { if (host) choose('direct'); else if (mode === 'direct') settle(); };
      ch.onclose = () => { if (mode === 'direct') lost(); };
    };
    const openConnection = () => {
      pc = new Connection({ iceServers });
      pc.onicecandidate = ({ candidate }) => { if (candidate) send({ t: 'signal', data: { candidate: candidate.toJSON() } }); };
      pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed' && mode === 'direct') lost(); };
      pc.ondatachannel = (e) => listen(e.channel);
    };

    peer.lost = () => { if (mode !== 'direct') lost(); };  // a direct match does not need the server
    peer.relay = (msg) => { if (mode !== 'direct' && !shut) deliver(msg); };
    let chain = Promise.resolve(), early = [];
    const handle = async (data) => {
      if (shut || !data || typeof data !== 'object') return;
      if (data.mode && !host && !mode) {
        if (data.mode !== 'direct') { mode = 'relay'; settle(); return; }
        if (!pc) { lost(); return; }                     // there is nothing direct to use
        mode = 'direct';
        if (channel?.readyState === 'open') settle();
      } else if (data.noDirect && host) choose('relay');
      else if (data.offer && !host) {
        if (pc) return;                                  // one offer only
        if (!direct) { send({ t: 'signal', data: { noDirect: true } }); return; }
        openConnection();
        await pc.setRemoteDescription(cleanDescription(data.offer, 'offer'));
        await pc.setLocalDescription();
        send({ t: 'signal', data: { answer: pc.localDescription.toJSON() } });
        for (const c of early.splice(0)) await pc.addIceCandidate(c).catch(() => {});
      } else if (data.answer && host && pc) {
        await pc.setRemoteDescription(cleanDescription(data.answer, 'answer'));
        for (const c of early.splice(0)) await pc.addIceCandidate(c).catch(() => {});
      } else if (data.candidate && direct) {
        if (++candidates > MAX_CANDIDATES || !isPlayerAddress(data.candidate)) return;
        if (pc?.remoteDescription) await pc.addIceCandidate(data.candidate).catch(() => {});
        else if (early.length < 40) early.push(data.candidate);
      }
    };
    peer.signal = (data) => { chain = chain.then(() => handle(data)).catch(() => { if (host) choose('relay'); }); };

    timer = setTimeout(() => {
      if (host) choose('relay');
      else if (!settled) timer = setTimeout(lost, directMs);
    }, directMs);
    if (!host) return;
    if (!direct) { choose('relay'); return; }
    openConnection();
    listen(pc.createDataChannel('match'));
    chain = chain.then(async () => {
      await pc.setLocalDescription();
      send({ t: 'signal', data: { offer: pc.localDescription.toJSON() } });
    }).catch(() => choose('relay'));
  });
}
