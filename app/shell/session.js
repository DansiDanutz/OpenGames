/* One match between two computers.

   Each move is signed by the player who made it and checked by the game's rules
   on both sides. The host puts moves in order; the order is a signed chain, so
   it cannot be rewritten later. The seed of the match is made from a secret of
   each player, revealed only after both have committed to theirs, so neither
   can choose it. */
import { canonical } from '../../kit/engine.js';

const enc = new TextEncoder();
const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (s) => new Uint8Array((s.match(/../g) || []).map((x) => parseInt(x, 16)));
export const sha256 = async (text) => hex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
const isHex = (s, n) => typeof s === 'string' && s.length === n && /^[0-9a-f]+$/.test(s);
export const cleanName = (s) => String(s ?? '').replace(/[\p{C}\s]+/gu, ' ').trim().slice(0, 24) || 'Player';

export async function createIdentity() {
  const keys = await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']);
  return { keys, pub: hex(await crypto.subtle.exportKey('raw', keys.publicKey)) };
}
const sign = async (identity, value) => hex(await crypto.subtle.sign('Ed25519', identity.keys.privateKey, enc.encode(canonical(value))));
async function verified(pub, sig, value) {
  if (!isHex(pub, 64) || !isHex(sig, 128)) return false;
  try {
    const key = await crypto.subtle.importKey('raw', unhex(pub), 'Ed25519', false, ['verify']);
    return await crypto.subtle.verify('Ed25519', key, unhex(sig), enc.encode(canonical(value)));
  } catch { return false; }
}
const signedMove = (match, player, n, move) => ({ match, player, n, move });
const signedEntry = (e) => ({ seq: e.seq, prev: e.prev, player: e.player, n: e.n, move: e.move, sig: e.sig, fingerprint: e.fingerprint });
const MAX_WAITING = 128;

/* table: what the game's page gives us
     start({ seed, me, players }) -> fingerprint
     tryMove(player, move)        -> { ok, error, result, fingerprint }
     refused(error)
   on: { opponent, started, entry, over, failed } */
export class Session {
  #wire; #table; #on; #identity; #host; #game;
  #me; #them; #name; #secret; #commit; #match; #head; #seq = 0; #sentN = 0; #seenN = [0, 0];
  #queue = Promise.resolve(); #inbox = Promise.resolve(); #waiting = 0; #closed = false; #over = false; #log = [];

  constructor({ wire, table, identity, host, game, name, on }) {
    this.#wire = wire; this.#table = table; this.#identity = identity; this.#host = host;
    this.#game = game; this.#name = cleanName(name); this.#on = on;
    this.#me = host ? 0 : 1;
  }

  /* Our greeting always goes out before the answer to theirs. */
  open() {
    this.#inbox = this.#inbox.then(() => this.#greet()).catch(() => this.#fail('The match could not start.'));
    const greeted = this.#inbox;
    const wire = this.#wire;                // listening starts here: their greeting may already be waiting
    wire.onMessage = (msg) => {
      if (this.#closed) return;
      if (++this.#waiting > MAX_WAITING) { this.#fail('The other computer sent too much at once.'); return; }
      this.#inbox = this.#inbox.then(() => this.#receive(msg)).catch(() => this.#fail('The other computer sent something this app does not understand.'))
        .finally(() => { this.#waiting--; });
    };
    wire.onClose = () => this.#fail('The connection was lost.');
    return greeted;
  }

  async #greet() {
    this.#secret = hex(crypto.getRandomValues(new Uint8Array(32)));
    this.#commit = await sha256(this.#secret);
    this.#wire.send({ t: 'hello', pub: this.#identity.pub, name: this.#name, game: this.#game.id, hash: this.#game.hash, commit: this.#commit });
  }

  /* The page wants to play a move. */
  async play(move) {
    if (this.#closed || this.#over || !this.#match) return;
    const n = ++this.#sentN;
    const sig = await sign(this.#identity, signedMove(this.#match, this.#me, n, move));
    const proposal = { player: this.#me, n, move, sig };
    if (this.#host) this.#enqueue(proposal);
    else this.#wire.send({ t: 'propose', n, move, sig });
  }

  close() { this.#closed = true; this.#wire.close(); }

  /* Everything a referee needs to play the match again. */
  transcript() {
    return { game: this.#game.id, hash: this.#game.hash, match: this.#match, seed: this.seed,
      players: this.players?.map((p) => ({ pub: p.pub, name: p.name })), entries: this.#log.slice() };
  }

  async #receive(msg) {
    if (this.#closed) return;
    if (msg?.t === 'hello') return this.#hello(msg);
    if (msg?.t === 'reveal') return this.#reveal(msg);
    if (msg?.t === 'propose' && this.#host && this.#match) return this.#proposed(msg);
    if (msg?.t === 'entry' && !this.#host && this.#match) return this.#entry(msg.entry);
    if (msg?.t === 'refused' && !this.#host && this.#match) return this.#table.refused(String(msg.error ?? '').slice(0, 200));
    return this.#fail('The other computer sent something this app does not understand.');
  }

  #hello(msg) {
    if (this.#them) return this.#fail('The other computer changed who it is.');
    if (!isHex(msg.pub, 64) || !isHex(msg.commit, 64) || msg.pub === this.#identity.pub || msg.commit === this.#commit) {
      return this.#fail('The other computer sent a bad greeting.');
    }
    if (msg.game !== this.#game.id || msg.hash !== this.#game.hash) return this.#fail('The other player has a different version of this game.');
    this.#them = { pub: msg.pub, name: cleanName(msg.name), commit: msg.commit };
    this.#on.opponent?.({ name: this.#them.name, tag: msg.pub.slice(0, 4) });
    this.#wire.send({ t: 'reveal', secret: this.#secret });
  }

  async #reveal(msg) {
    if (!this.#them || this.#match || !isHex(msg.secret, 64) || (await sha256(msg.secret)) !== this.#them.commit) {
      return this.#fail('The other computer did not keep its word about the start of the match.');
    }
    const mine = { pub: this.#identity.pub, name: this.#name, secret: this.#secret };
    const theirs = { pub: this.#them.pub, name: this.#them.name, secret: msg.secret };
    const pair = this.#host ? [mine, theirs] : [theirs, mine];
    this.seed = await sha256(`seed|${pair[0].secret}|${pair[1].secret}`);
    this.players = pair.map(({ pub, name }) => ({ pub, name }));
    const match = await sha256(canonical({ game: this.#game.id, hash: this.#game.hash, seed: this.seed, players: pair.map((p) => p.pub) }));
    const fingerprint = await this.#table.start({ seed: this.seed, me: this.#me, players: pair.map((p) => ({ name: p.name })) });
    if (this.#closed) return undefined;
    this.#head = await sha256(`${match}|${fingerprint}`);
    this.#match = match;
    this.#on.started?.({ me: this.#me, players: this.players });
    return undefined;
  }

  async #proposed(msg) {
    const p = { player: 1, n: msg.n, move: msg.move, sig: msg.sig };
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
      else this.#wire.send({ t: 'refused', error: out.error });
      return;
    }
    const entry = { seq: this.#seq + 1, prev: this.#head, player: p.player, n: p.n, move: p.move, sig: p.sig, fingerprint: out.fingerprint };
    entry.hsig = await sign(this.#identity, signedEntry(entry));
    await this.#accept(entry, out);
    this.#wire.send({ t: 'entry', entry });
  }

  /* Guest only: check everything the host says before believing it. */
  async #entry(e) {
    if (!e || e.seq !== this.#seq + 1 || e.prev !== this.#head || ![0, 1].includes(e.player) || !Number.isInteger(e.n) || e.n <= this.#seenN[e.player]) {
      return this.#fail('The moves arrived in the wrong order.');
    }
    const author = this.players[e.player].pub;
    if (!(await verified(author, e.sig, signedMove(this.#match, e.player, e.n, e.move)))
      || !(await verified(this.players[0].pub, e.hsig, signedEntry(e)))) return this.#fail('A move was not signed by its player.');
    const out = await this.#table.tryMove(e.player, e.move);
    if (!out.ok) return this.#fail(`The other computer made a move the rules do not allow (${out.error}).`);
    if (out.fingerprint !== e.fingerprint) return this.#fail('The two computers disagree about the game.');
    this.#seenN[e.player] = e.n;
    return this.#accept(e, out);
  }

  async #accept(entry, out) {
    this.#seq = entry.seq;
    this.#head = await sha256(canonical(signedEntry(entry)));
    this.#log.push(entry);
    this.#on.entry?.(entry);
    if (!out.result) return;
    this.#over = true;
    this.#on.over?.({ result: out.result, me: this.#me, transcript: this.transcript() });
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
  const id = await sha256(canonical({ game: t.game, hash: t.hash, seed: t.seed, players: t.players.map((p) => p.pub) }));
  if (id !== t.match) return bad('the match does not belong to these players');
  const match = createMatch(t.seed);
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
  return result ? { ok: true, result } : bad('the match is not finished');
}
