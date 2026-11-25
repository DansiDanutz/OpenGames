// SPDX-License-Identifier: MIT
/* Used by a game's page. The page only talks to the OpenGames app, through one
   message port: it has no network, no files and no account.

     import * as rules from './rules.js';
     import { connect } from '/kit/ui.js';
     connect(rules, {
       start({ view, me, players }) {},   // draw the first position
       update({ view, by }) {},           // somebody moved
       end({ result, me }) {},            // the match is over
     }).then((table) => table.play(move)); */
import { Match } from './engine.js';

export async function connect(rules, page) {
  const app = globalThis.opengames;
  if (!app) throw new Error('open this game in OpenGames');
  let match = null, me = 0;
  const table = {
    play: (move) => app.send({ t: 'move', move }),
    resign: () => app.send({ t: 'move', move: { $: 'resign' } }),
  };
  const handlers = {
    start(msg) {
      me = msg.me;
      match = new Match(rules, { seed: msg.seed, players: msg.players.length });
      page.start({ view: match.view(me), me, players: msg.players });
      app.send({ t: 'started', fingerprint: match.fingerprint() });
    },
    try(msg) {
      const out = match.play(msg.player, msg.move);
      app.send({ t: 'tried', id: msg.id, ...out });
      if (!out.ok) return;
      page.update({ view: match.view(me), by: msg.player });
      if (out.result) page.end({ result: out.result, me });
    },
    refused(msg) { page.refused?.({ error: msg.error, view: match.view(me) }); },
  };
  app.onMessage((msg) => handlers[msg?.t]?.(msg));
  app.send({ t: 'ready' });
  return table;
}
