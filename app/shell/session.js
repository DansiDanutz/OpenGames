/* One match between two computers.

   Each move is signed by the player who made it and checked by the game's rules
   on both sides. The host puts moves in order; the order is a signed chain, so
   it cannot be rewritten later. The seed of the match is made from a secret of
   each player, revealed only after both have committed to theirs, so neither
   can choose it. Before that the host states the rules of the match (board, difficulty,
   number of games) and the other player accepts them or leaves. */
import { canonical, cleanTerms } from '../../kit/engine.js';

const enc = new TextEncoder();
const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (s) => new Uint8Array((s.match(/../g) || []).map((x) => parseInt(x, 16)));
export const sha256 = async (text) => hex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
const isHex = (s, n) => typeof s === 'string' && s.length === n && /^[0-9a-f]+$/.test(s);
export const cleanName = (s) => String(s ?? '').replace(/[\p{C}\s<>&"`]+/gu, ' ').replaceAll("'", '’').trim().slice(0, 24) || 'Player';

export async function createIdentity() {
  const keys = await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']);
  return { keys, pub: hex(await crypto.subtle.exportKey('raw', keys.publicKey)) };
}
export const sign = async (identity, value) => hex(await crypto.subtle.sign('Ed25519', identity.keys.privateKey, enc.encode(canonical(value))));
export async function verified(pub, sig, value) {
  if (!isHex(pub, 64) || !isHex(sig, 128)) return false;
  try {
    const key = await crypto.subtle.importKey('raw', unhex(pub), 'Ed25519', false, ['verify']);
    return await crypto.subtle.verify('Ed25519', key, unhex(sig), enc.encode(canonical(value)));
  } catch { return false; }
}
const signedMove = (match, player, n, move) => ({ match, player, n, move });
const signedEntry = (e) => ({ seq: e.seq, prev: e.prev, player: e.player, n: e.n, move: e.move, sig: e.sig, fingerprint: e.fingerprint });
const MAX_MOVE_BYTES = 1400;           // so that a whole match always fits what the server takes
const isSmall = (move) => enc.encode(JSON.stringify(move) ?? '').length <= MAX_MOVE_BYTES;
const MAX_WAITING = 128, MAX_ENTRIES = 2000, MAX_PROPOSALS_PER_SECOND = 40, HANDSHAKE_MS = 15000, PACE = 10, PACE_MS = 500, TERMS_MS = 120000;

/* table: what the game's page gives us
     start({ seed, me, players, terms, sound }) -> fingerprint
     tryMove(player, move)        -> { ok, error, result, fingerprint }
     refused(error)
   on: { opponent, terms, started, entry, ended, over, failed }
   `on.terms` is asked on the guest's side and answers true or false. */
export class Session {
  #wire; #table; #on; #identity; #host; #game;
  #me; #them; #name; #secret; #commit; #match; #head; #seq = 0; #sentN = 0; #seenN = [0, 0];
  #queue = Promise.resolve(); #inbox = Promise.resolve(); #waiting = 0; #closed = false; #over = false; #log = [];
  #sending = Promise.resolve(); #handshakeMs; #termsMs; #terms = null; #ticket; #theirPub; #sound; #accepted = false; #reviewing = false; #timer = null; #rate = { second: 0, used: 0 };
  #unseen = new Map(); #isCaughtUp = true; #isAsked = false;

  constructor({ wire, table, identity, host, game, name, on, terms = {}, ticket = null, theirPub = null, sound = true, handshakeMs = HANDSHAKE_MS, termsMs = TERMS_MS }) {
    this.#handshakeMs = handshakeMs; this.#termsMs = termsMs; this.#ticket = ticket; this.#theirPub = theirPub; this.#sound = sound;
    if (host) this.#terms = cleanTerms(game.options ?? [], { ...terms, ticket });
    this.#wire = wire; this.#table = table; this.#identity = identity; this.#host = host;
    this.#game = game; this.#name = cleanName(name); this.#on = on;
    this.#me = host ? 0 : 1;
  }

  /* Our greeting always goes out before the answer to theirs. */
  open() {
    this.#inbox = this.#inbox.then(() => this.#greet()).catch(() => this.#fail('The match could not start.'));
    const greeted = this.#inbox;
    this.#wait(this.#handshakeMs, 'The other computer did not start the match.');
    this.#listen();
    return greeted;
  }

  /* Their greeting may already be waiting. */
  #listen() {
    const wire = this.#wire;
    wire.onMessage = (msg) => {
      if (this.#closed || wire !== this.#wire) return;
      if (++this.#waiting > (this.#isCaughtUp ? MAX_WAITING : MAX_ENTRIES)) { this.#fail('The other computer sent too much at once.'); return; }
      this.#inbox = this.#inbox.then(() => this.#receive(msg)).catch(() => this.#fail('The other computer sent something this app does not understand.'))
        .finally(() => { this.#waiting--; });
    };
    // What arrived before the line closed still counts, unless this player is being asked something.
    wire.onClose = () => {
      const lost = () => {
        if (wire !== this.#wire || this.#closed) return;
        if (this.#match && this.#on.lost) { this.#isCaughtUp = this.#isAsked = false; if (!this.#over) this.#on.lost(); } else this.#fail('The connection was lost.');
      };
      if (this.#reviewing) lost(); else this.#inbox = this.#inbox.then(lost);
    };
  }

  get match() { return this.#match ?? null; }

  /* The same match over a new line. The guest says how far it is; the host sends what is missing. */
  resume(wire) {
    this.#isCaughtUp = false;
    this.#inbox = this.#inbox.then(() => {
      if (this.#closed) { wire.close(); return; }
      this.#wire.close();
      this.#wire = wire;
      this.#isAsked = false;
      if (!this.#host) wire.send({ t: 'resume', match: this.#match, seq: this.#seq });
      this.#listen();
    }).catch(() => this.#fail('The match could not continue.'));
    return this.#inbox;
  }
  /* Host only, after everything that already arrived has its place. */
  #resumed({ match, seq }) {
    if (this.#isCaughtUp || this.#isAsked || match !== this.#match || !Number.isInteger(seq) || seq < 0 || seq > this.#log.length) return this.#fail('The other computer sent something this app does not understand.');
    this.#isAsked = true;
    this.#queue = this.#queue.then(async () => {
      if (!(await this.#paced(this.#log.slice(seq).map((entry) => ({ t: 'entry', entry }))))) return;
      this.#wire.send({ t: 'caught', n: this.#seenN[1] });
      this.#isCaughtUp = true;
      this.#on.resumed?.();
    });
    return undefined;
  }
  /* Nobody accepts a whole outage at once. False when this line is gone before the end. */
  async #paced(messages) {
    const wire = this.#wire;
    const isGone = () => this.#closed || wire !== this.#wire || !this.#isAsked;
    for (const [i, msg] of messages.entries()) {
      if (i && i % PACE === 0) await new Promise((resolve) => { setTimeout(resolve, PACE_MS); });
      if (isGone()) return false;
      wire.send(msg);
    }
    return !isGone();
  }
  /* Guest only: what the host never got is sent again; what it got and did not take was refused. */
  #caught(n) {
    if (this.#isCaughtUp || this.#isAsked || !Number.isInteger(n)) return this.#fail('The other computer sent something this app does not understand.');
    this.#isAsked = true;
    for (const k of this.#unseen.keys()) if (k <= n) { this.#unseen.delete(k); this.#table.refused('The move was not accepted.'); }
    // In the same queue as new moves, so the numbers stay in order.
    this.#sending = this.#sending.then(async () => {
      if (!(await this.#paced([...this.#unseen.values()]))) return;
      this.#isCaughtUp = true;
      this.#on.resumed?.();
    });
    return undefined;
  }

  #wait(ms, reason) { clearTimeout(this.#timer); this.#timer = setTimeout(() => this.#fail(reason), ms); }

  async #greet() {
    this.#secret = hex(crypto.getRandomValues(new Uint8Array(32)));
    this.#commit = await sha256(this.#secret);
    this.#wire.send({ t: 'hello', pub: this.#identity.pub, name: this.#name, game: this.#game.id, hash: this.#game.hash, commit: this.#commit, ...(this.#host ? { terms: this.#terms } : {}) });
  }

  /* The page wants to play a move. */
  play(move) {
    this.#sending = this.#sending.then(() => this.#send(move)).catch(() => this.#table.refused('That move could not be sent.'));
    return this.#sending;
  }

  /* One at a time, so the numbers always go out in order. */
  async #send(move) {
    if (this.#closed || this.#over || !this.#match) return;
    canonical(move);
    if (!isSmall(move)) throw new Error('the move is too large');
    const n = ++this.#sentN;
    const sig = await sign(this.#identity, signedMove(this.#match, this.#me, n, move));
    const proposal = { player: this.#me, n, move, sig };
    if (this.#closed) return;
    if (this.#host) this.#enqueue(proposal);
    else {
      this.#unseen.set(n, { t: 'propose', n, move, sig });
      if (this.#isCaughtUp) this.#wire.send(this.#unseen.get(n));
    }
  }

  close() { this.#closed = true; clearTimeout(this.#timer); this.#wire.close(); }

  /* Everything a referee needs to play the match again. */
  transcript() {
    return { game: this.#game.id, hash: this.#game.hash, match: this.#match, seed: this.seed, terms: this.#terms,
      players: this.players?.map((p) => ({ pub: p.pub, name: p.name })), entries: this.#log.slice() };
  }

  async #receive(msg) {
    if (this.#closed) return;
    if (msg?.t === 'hello') return this.#hello(msg);
    if (msg?.t === 'accept' && this.#host && this.#them && !this.#accepted) return this.#agreed();
    if (msg?.t === 'decline' && this.#host && !this.#match) return this.#fail('The other player did not accept the rules.');
    if (msg?.t === 'reveal') return this.#reveal(msg);
    if (msg?.t === 'propose' && this.#host && this.#match) return this.#proposed(msg);
    if (msg?.t === 'entry' && !this.#host && this.#match) return this.#entry(msg.entry);
    if (msg?.t === 'refused' && !this.#host && this.#match) { this.#unseen.delete(msg.n); return this.#table.refused('The move was not accepted.'); }
    if (msg?.t === 'resume' && this.#host && this.#match) return this.#resumed(msg);
    if (msg?.t === 'caught' && !this.#host && this.#match) return this.#caught(msg.n);
    return this.#fail('The other computer sent something this app does not understand.');
  }

  #hello(msg) {
    if (this.#them) return this.#fail('The other computer changed who it is.');
    if (!isHex(msg.pub, 64) || !isHex(msg.commit, 64) || msg.pub === this.#identity.pub || msg.commit === this.#commit) {
      return this.#fail('The other computer sent a bad greeting.');
    }
    if (this.#ticket && this.#theirPub && msg.pub !== this.#theirPub) return this.#fail('This is not the player the server introduced.');
    if (msg.game !== this.#game.id || msg.hash !== this.#game.hash) return this.#fail('The other player has a different version of this game.');
    this.#them = { pub: msg.pub, name: cleanName(msg.name), commit: msg.commit };
    this.#on.opponent?.({ name: this.#them.name, tag: msg.pub.slice(0, 4) });
    if (this.#host) return this.#wait(this.#termsMs, 'The other player did not answer.');
    return this.#review(msg.terms);
  }

  /* Guest only: the host's rules, for the player to accept. Nothing about the board is known yet. */
  async #review(offered) {
    let terms;
    try { terms = cleanTerms(this.#game.options ?? [], offered); } catch { return this.#fail('The other computer offered rules this game does not have.'); }
    if (terms.ticket !== this.#ticket) return this.#fail('The other computer sent a bad greeting.');
    this.#wait(this.#termsMs, 'You did not answer in time.');
    this.#reviewing = true;
    const isAgreed = this.#on.terms ? await this.#on.terms({ terms, name: this.#them.name }) : true;
    this.#reviewing = false;
    if (this.#closed) return undefined;
    if (!isAgreed) { this.#wire.send({ t: 'decline' }); this.close(); return undefined; }
    this.#terms = terms;
    this.#wire.send({ t: 'accept' });
    return this.#agreed();
  }

  #agreed() {
    this.#accepted = true;
    this.#wait(this.#handshakeMs, 'The other computer did not start the match.');
    this.#wire.send({ t: 'reveal', secret: this.#secret });
  }

  async #reveal(msg) {
    if (!this.#them || !this.#accepted || this.#match || !isHex(msg.secret, 64) || (await sha256(msg.secret)) !== this.#them.commit) {
      return this.#fail('The other computer did not keep its word about the start of the match.');
    }
    const mine = { pub: this.#identity.pub, name: this.#name, secret: this.#secret };
    const theirs = { pub: this.#them.pub, name: this.#them.name, secret: msg.secret };
    const pair = this.#host ? [mine, theirs] : [theirs, mine];
    this.seed = await sha256(`seed|${pair[0].secret}|${pair[1].secret}`);
    this.players = pair.map(({ pub, name }) => ({ pub, name }));
    const match = await sha256(canonical({ game: this.#game.id, hash: this.#game.hash, seed: this.seed, terms: this.#terms, players: this.players }));
    if (this.#closed) return undefined;
    const fingerprint = await this.#table.start({ seed: this.seed, me: this.#me, players: pair.map((p) => ({ name: p.name })), terms: this.#terms, sound: this.#sound });
    if (this.#closed) return undefined;
    this.#head = await sha256(`${match}|${fingerprint}`);
    this.#match = match;
    clearTimeout(this.#timer);
    this.#on.started?.({ me: this.#me, players: this.players, terms: this.#terms });
    return undefined;
  }

  async #proposed(msg) {
    const p = { player: 1, n: msg.n, move: msg.move, sig: msg.sig };
    const second = Math.floor(Date.now() / 1000);
    this.#rate = { second, used: this.#rate.second === second ? this.#rate.used + 1 : 1 };
    if (this.#rate.used > MAX_PROPOSALS_PER_SECOND) return this.#fail('The other computer sent too much at once.');
    if (!isSmall(p.move)) return this.#fail('The other computer sent too much at once.');
    if (!Number.isInteger(p.n) || p.n <= this.#seenN[1]) return this.#fail('The other computer repeated a move.');
    if (!(await verified(this.#them.pub, p.sig, signedMove(this.#match, 1, p.n, p.move)))) return this.#fail('A move was not signed by the other player.');
    this.#seenN[1] = p.n;
    return this.#enqueue(p);
  }

  #enqueue(p) {
    this.#queue = this.#queue.then(() => this.#order(p)).catch(() => this.#fail('The match could not continue.'));
    return this.#queue;
  }

  /* Host only: try the move, then publish it as the next entry. */
  async #order(p) {
    if (this.#closed) return;
    const out = await this.#table.tryMove(p.player, p.move);
    if (!out.ok) {
      if (p.player === this.#me) this.#table.refused(out.error);
      else if (this.#isCaughtUp) this.#wire.send({ t: 'refused', n: p.n, error: out.error });
      return;
    }
    const entry = { seq: this.#seq + 1, prev: this.#head, player: p.player, n: p.n, move: p.move, sig: p.sig, fingerprint: out.fingerprint };
    entry.hsig = await sign(this.#identity, signedEntry(entry));
    await this.#accept(entry, out);
    if (this.#isCaughtUp) this.#wire.send({ t: 'entry', entry });
  }

  /* Guest only: check everything the host says before believing it. */
  async #entry(e) {
    if (!e || e.seq !== this.#seq + 1 || e.prev !== this.#head || ![0, 1].includes(e.player) || !Number.isInteger(e.n) || e.n <= this.#seenN[e.player] || !isSmall(e.move)) {
      return this.#fail('The moves arrived in the wrong order.');
    }
    const author = this.players[e.player].pub;
    if (!(await verified(author, e.sig, signedMove(this.#match, e.player, e.n, e.move)))
      || !(await verified(this.players[0].pub, e.hsig, signedEntry(e)))) return this.#fail('A move was not signed by its player.');
    if (this.#closed) return undefined;
    const out = await this.#table.tryMove(e.player, e.move);
    if (!out.ok) return this.#fail(`The other computer made a move the rules do not allow (${out.error}).`);
    if (out.fingerprint !== e.fingerprint) return this.#fail('The two computers disagree about the game.');
    this.#seenN[e.player] = e.n;
    if (e.player === this.#me) this.#unseen.delete(e.n);
    return this.#accept({ ...signedEntry(e), hsig: e.hsig }, out);     // nothing that nobody signed
  }

  async #accept(entry, out) {
    this.#seq = entry.seq;
    this.#head = await sha256(canonical(signedEntry(entry)));
    this.#log.push(entry);
    if (this.#log.length >= MAX_ENTRIES && !out.result) return this.#fail('The match is too long.');
    this.#on.entry?.(entry);
    if (out.score) this.#on.ended?.({ score: out.score });
    if (!out.result) return undefined;
    this.#over = true;
    this.#on.over?.({ result: out.result, me: this.#me, transcript: this.transcript() });
    return undefined;
  }

  #fail(reason) {
    if (this.#closed) return;
    this.close();
    if (!this.#over) this.#on.failed?.(reason);
  }
}

/* A referee plays a finished match again and says who won, or why not. */
export async function verifyTranscript(t, createMatch) {
  const bad = (reason) => ({ ok: false, reason });
  if (t?.players?.length !== 2 || !Array.isArray(t.entries)) return bad('not a transcript');
  const id = await sha256(canonical({ game: t.game, hash: t.hash, seed: t.seed, terms: t.terms, players: t.players.map(({ pub, name }) => ({ pub, name })) }));
  if (id !== t.match) return bad('the match does not belong to these players');
  const match = createMatch(t.seed, t.terms);
  let head = await sha256(`${t.match}|${match.fingerprint()}`);
  const seen = [0, 0];
  let result = null;
  for (const [i, e] of t.entries.entries()) {
    if (e.seq !== i + 1 || e.prev !== head || ![0, 1].includes(e.player) || !(e.n > seen[e.player])) return bad(`move ${i + 1} is out of order`);
    if (!(await verified(t.players[e.player].pub, e.sig, signedMove(t.match, e.player, e.n, e.move)))) return bad(`move ${i + 1} is not signed by its player`);
    if (!(await verified(t.players[0].pub, e.hsig, signedEntry(e)))) return bad(`move ${i + 1} is not signed by the host`);
    const out = match.play(e.player, e.move);
    if (!out.ok || out.fingerprint !== e.fingerprint) return bad(`move ${i + 1} is not allowed by the rules`);
    seen[e.player] = e.n;
    head = await sha256(canonical(signedEntry(e)));
    result = out.result;
  }
  return result ? { ok: true, result } : { ...bad('the match is not finished'), unfinished: true };
}
