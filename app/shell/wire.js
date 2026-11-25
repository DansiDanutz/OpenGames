/* Connects two players. The match server introduces them; then they try a
   direct connection. When that fails, or a player hides their address, the
   match server passes the messages on. */
const DIRECT_MS = 6000;
const MAX_TEXT = 24 * 1024;

const parse = (text) => {
  if (typeof text !== 'string' || text.length > MAX_TEXT) return undefined;
  try { return JSON.parse(text); } catch { return undefined; }
};

/* Opens the line to the match server. `on` gets: code, searching, paired, error, closed. */
export function meet({ url, key, ask, on, Socket = globalThis.WebSocket }) {
  const ws = new Socket(url);
  let paired = false, ended = false, peer = null;
  const end = (reason) => { if (ended) return; ended = true; if (!paired) on.closed?.(reason); else peer?.lost(); };
  const send = (msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };
  ws.onopen = () => send({ ...ask, key });
  ws.onerror = () => end('offline');
  ws.onclose = () => end('offline');
  ws.onmessage = ({ data }) => {
    const msg = parse(data);
    if (!msg) return;
    if (msg.t === 'code' || msg.t === 'searching' || msg.t === 'error') on[msg.t]?.(msg);
    else if (msg.t === 'expired') end('expired');
    else if (msg.t === 'paired' && !paired) {
      paired = true;
      peer = { signal: () => {}, relay: () => {}, lost: () => {} };
      on.paired({ host: msg.host === true, peer, send, close: () => { ended = true; ws.close(); } });
    } else if (msg.t === 'signal') peer?.signal(msg.data);
    else if (msg.t === 'relay') peer?.relay(msg.data);
    else if (msg.t === 'gone') peer?.lost();
  };
  return { cancel() { ended = true; ws.close(); } };
}

/* Resolves to { mode: 'direct' | 'relay', send, close, onMessage, onClose }. */
export function link({ host, peer, send, close }, { hideAddress = false, iceServers = [], directMs = DIRECT_MS, Connection = globalThis.RTCPeerConnection } = {}) {
  return new Promise((resolve, reject) => {
    const direct = !hideAddress && !!Connection;
    let pc = null, channel = null, mode = null, settled = false, shut = false, timer = null;
    const inbox = [];
    const wire = {
      mode: null, onClose: () => {},
      send(msg) {
        const text = JSON.stringify(msg);
        if (shut || text.length > MAX_TEXT) return;
        if (mode === 'direct') { if (channel.readyState === 'open') channel.send(text); } else send({ t: 'relay', data: msg });
      },
      close() { if (shut) return; shut = true; clearTimeout(timer); channel?.close(); pc?.close(); close(); },
      set onMessage(fn) { deliver = fn; inbox.splice(0).forEach(fn); },
    };
    let deliver = (msg) => { if (inbox.length < 64) inbox.push(msg); };
    const lost = () => { if (shut) return; wire.close(); if (settled) wire.onClose(); else reject(new Error('The other player left.')); };
    const settle = () => { if (settled || shut) return; settled = true; clearTimeout(timer); wire.mode = mode; resolve(wire); };
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
        await pc.setRemoteDescription(data.offer);
        await pc.setLocalDescription();
        send({ t: 'signal', data: { answer: pc.localDescription.toJSON() } });
        for (const c of early.splice(0)) await pc.addIceCandidate(c).catch(() => {});
      } else if (data.answer && host && pc) {
        await pc.setRemoteDescription(data.answer);
        for (const c of early.splice(0)) await pc.addIceCandidate(c).catch(() => {});
      } else if (data.candidate && direct) {
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
