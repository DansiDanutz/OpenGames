// SPDX-License-Identifier: MIT
/* The computer as the second player of a match alone. It uses the game's own bot, which sees only what
   a player in that seat may see. `notes` are its own, for one game: a hidden fleet, for example. */
import { createRandom } from './engine.js';

export const USUAL_PACE_MS = 900;

export function createComputer(rules, series, player, { options, seed }) {
  const random = createRandom(seed);
  let round = -1, own = null;
  return {
    /* The next move, or null when it is not its turn. */
    move() {
      if (series.result()) return null;
      if (round !== series.round) { round = series.round; own = { options, notes: {} }; }
      const move = rules.bot(series.view(player), series.seat(player), random, own) ?? null;
      return move && { round, move };
    },
    /* Milliseconds until it should be asked again. */
    pace: () => (rules.pace && !series.result() ? rules.pace(series.view(player), series.seat(player), random) : USUAL_PACE_MS),
  };
}
