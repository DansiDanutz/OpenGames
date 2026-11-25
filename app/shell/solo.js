/* A match against the computer, on this computer only: no server, no other person, no signatures, and
   never ranked. The game's page plays the computer's moves and checks every move by its rules. */
import { cleanTerms } from '../../kit/engine.js';
import { cleanName } from './session.js';

const FIRST_MS = 900, PAUSE_MS = 4500;                  // a little longer than the page shows how a game ended
const ME = 0, COMPUTER = 1;
const randomHex = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');

/* The table and `on` are those of Session. */
export class Solo {
  #table; #on; #terms; #name; #sound; #pauseMs; #queue = Promise.resolve(); #timer = null; #isIdle = false; #idleMs = FIRST_MS; #done = false;

  constructor({ table, game, name, on, terms = {}, sound = true, pauseMs = PAUSE_MS }) {
    this.#table = table; this.#on = on; this.#name = cleanName(name); this.#sound = sound; this.#pauseMs = pauseMs;
    this.#terms = cleanTerms(game.options ?? [], { ...terms, ranked: false, ticket: null });
  }

  async open() {
    const players = [{ name: this.#name }, { name: 'Computer' }], terms = this.#terms;
    try { await this.#table.start({ seed: randomHex(), me: ME, players, terms, sound: this.#sound, solo: true }); } catch (error) { this.#fail(error.message); return; }
    if (this.#done) return;
    this.#on.started?.({ me: ME, players, terms });
    this.#next(FIRST_MS);
  }

  /* The player's move. */
  play(move) {
    return this.#run(async () => {
      const out = await this.#table.tryMove(ME, move);
      if (this.#done) return;
      if (!out.ok) { this.#table.refused(out.error); return; }
      this.#accept(ME, out);
      if (this.#isIdle) this.#next(this.#idleMs);
    });
  }

  close() { this.#done = true; clearTimeout(this.#timer); }

  #run(step) {
    this.#queue = this.#queue.then(() => (this.#done ? undefined : step())).catch((error) => this.#fail(error.message));
    return this.#queue;
  }
  #next(ms) {
    clearTimeout(this.#timer);
    if (!this.#done) this.#timer = setTimeout(() => this.#run(() => this.#think()), ms);
  }
  async #think() {
    const { move, ms } = await this.#table.think();
    if (this.#done) return;
    this.#isIdle = !move;
    this.#idleMs = ms;
    this.#next(ms);
    if (!move) return;
    const out = await this.#table.tryMove(COMPUTER, move);
    if (this.#done) return;
    if (!out.ok) this.#fail(`The computer player made a move the rules do not allow (${out.error}).`);
    else this.#accept(COMPUTER, out);
  }
  #accept(player, out) {
    this.#on.entry?.({ player });
    if (out.score) { this.#isIdle = false; this.#on.ended?.({ score: out.score }); this.#next(this.#pauseMs); }
    if (!out.result) return;
    this.close();
    this.#on.over?.({ result: out.result, me: ME, transcript: null });
  }
  #fail(reason) {
    if (this.#done) return;
    this.close();
    this.#on.failed?.(reason);
  }
}
