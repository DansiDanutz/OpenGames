// SPDX-License-Identifier: MIT
/* Used by a game's page. The page only talks to the OpenGames app, through one
   message port: it has no network, no files and no account.

     import * as rules from './rules.js';
     import { connect } from '/kit/ui.js';
     connect(rules, {
       start({ view, me, players, options, round, rounds, score }) {},   // a game begins; me is 0 or 1
       update({ view, by }) {},                                          // somebody moved
       end({ result, me, view, score, isLast }) {},                      // the game is over
     }).then((table) => table.play(move));

   In a best of three or five, `start` is called again for every game and `me` may change. */
import { Series } from './engine.js';
import { setSound } from './sound.js';

const PAUSE_MS = 4000;                                  // to see how a game ended before the next

export async function connect(rules, page) {
  const app = globalThis.opengames;
  if (!app) throw new Error('open this game in OpenGames');
  let series = null, player = 0, terms = null, names = [], shown = -1;
  const table = {
    play: (move) => app.send({ t: 'move', move: { round: series.round, move } }),
    resign: () => app.send({ t: 'move', move: { $: 'resign' } }),
  };
  function deal() {
    if (!series || series.result()) return;
    shown = series.round;
    const me = series.seat(player);
    page.start({ view: series.view(player), me, players: me === player ? names : [names[1], names[0]], options: terms.options,
      round: series.round, rounds: terms.rounds, score: series.score });
  }
  const handlers = {
    start(msg) {
      ({ me: player, terms, players: names } = msg);
      setSound(msg.sound !== false);
      series = new Series(rules, { seed: msg.seed, terms });
      deal();
      app.send({ t: 'started', fingerprint: series.fingerprint() });
    },
    try(msg) {
      const seats = [series.seat(0), series.seat(1)], out = series.play(msg.player, msg.move), by = seats[msg.player], me = seats[player];
      const { ended, ...answer } = out;
      app.send({ t: 'tried', id: msg.id, ...answer, ...(ended ? { score: ended.score } : {}) });
      if (!out.ok) return;
      if (ended) {
        page.update({ view: ended.view[me], by });
        page.end({ result: { winner: ended.seat, reason: ended.reason }, me, view: ended.view[me], score: ended.score, isLast: !!out.result });
        if (!out.result) setTimeout(deal, PAUSE_MS);
      } else if (out.result) page.end({ result: { winner: seats[out.result.winner], reason: out.result.reason }, me, view: null, score: out.result.score, isLast: true });
      else if (shown === series.round) page.update({ view: series.view(player), by });
    },
    refused(msg) { if (shown === series?.round) page.refused?.({ error: msg.error, view: series.view(player) }); },
    sound(msg) { setSound(msg.on !== false); },
  };
  app.onMessage((msg) => handlers[msg?.t]?.(msg));
  app.send({ t: 'ready' });
  return table;
}
