import * as shikaku from '../games/shikaku/rules.js';
import { Match } from '../kit/engine.js';
import { Session, createIdentity } from '../app/shell/session.js';

export const GAME = { id: 'shikaku', hash: 'a'.repeat(64) };
export function tableFor(rules) {
  const t = { match: null, refusals: [], view: () => t.match.view(0) };
  t.start = async ({ seed, players }) => { t.match = new Match(rules, { seed, players: players.length }); return t.match.fingerprint(); };
  t.tryMove = async (player, move) => t.match.play(player, move);
  t.refused = (error) => t.refusals.push(error);
  return t;
}
/* Two wires joined together. `tamper` may change or drop what the host sends. */
export function wires({ tamper = (m) => m } = {}) {
  // Like the real line, messages wait until somebody listens.
  const make = () => {
    let listener = null;
    const early = [];
    return { onClose: () => {}, open: true, close() { this.open = false; },
      get onMessage() { return listener ?? ((m) => early.push(m)); },
      set onMessage(fn) { listener = fn; early.splice(0).forEach(fn); } };
  };
  const a = make(), b = make();
  const hangUp = (from, to) => { from.close = () => { if (!from.open) return; from.open = false; queueMicrotask(() => { if (to.open) { to.open = false; to.onClose(); } }); }; };
  hangUp(a, b); hangUp(b, a);
  const carry = (to, change) => (msg) => { const m = change(structuredClone(msg)); if (m && to.open) queueMicrotask(() => to.onMessage(m)); };
  a.send = carry(b, tamper); b.send = carry(a, (m) => m);
  return [a, b];
}
export async function pair({ tamper, guestRules = shikaku, hostRules = shikaku, guestGame = GAME, lateGuest = false } = {}) {
  const [wa, wb] = wires({ tamper });
  const side = async (wire, host, rules, game) => {
    const s = { table: tableFor(rules), failed: null, over: null, wire };
    let began;
    s.began = new Promise((r) => { began = r; });
    s.identity = await createIdentity();
    s.session = new Session({ wire, table: s.table, identity: s.identity, host, game, name: host ? 'Ann' : 'Bob',
      on: { started: began, failed: (r) => { s.failed = r; began(); }, over: (o) => { s.over = o; } } });
    return s;
  };
  const host = await side(wa, true, hostRules, GAME);
  host.session.open();
  if (lateGuest) await new Promise((r) => setTimeout(r, 30));
  const guest = await side(wb, false, guestRules, guestGame);
  guest.session.open();
  await Promise.all([host.began, guest.began]);
  return { host, guest };
}
export const until = async (check, ms = 3000) => {
  const end = Date.now() + ms;
  while (!check()) { if (Date.now() > end) throw new Error(`timed out: ${check}`); await new Promise((r) => setTimeout(r, 5)); }
};
export const solution = (side) => ({ type: 'solve', rects: shikaku.solve(side.table.view().puzzle) });
