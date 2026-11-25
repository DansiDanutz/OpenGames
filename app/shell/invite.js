/* What a player sends to a friend: the game, the code and a link that joins with one tap. */
import { cleanTerms } from '../../kit/engine.js';
import { cleanName } from './session.js';

const CODE = /^[A-HJ-NP-Z2-9]{8}$/;                       // what the match server gives out
export const isCode = (v) => typeof v === 'string' && CODE.test(v);

/* The rules and the name travel in the link, so the friend reads them before joining. */
export function inviteLink({ game, code, server, terms = {}, name = '' }) {
  if (!isCode(code)) throw new Error('not a code');
  const url = new URL(server);
  if (!['wss:', 'https:'].includes(url.protocol)) return null;
  const { options, rounds } = cleanTerms(game.options ?? [], { options: terms.options, rounds: terms.rounds });
  const says = new URLSearchParams([[game.id, code], ...Object.entries(options), ['games', rounds], ...(terms.ranked ? [['ranked', 1]] : []), ['by', cleanName(name)]]);
  return `https://${url.host}/play#${says}`;
}
/* null when this is not an invite to a game of the library. The text in a link can be anything. */
export function readInvite(hash, library) {
  if (typeof hash !== 'string' || hash.length > 600) return null;
  const says = new URLSearchParams(hash.replace(/^#/, '')), [first] = says;
  const game = first && library.find((g) => g.id === first[0]);
  if (!game || !isCode(first[1])) return null;
  const names = game.options.map((o) => o.id);
  let terms = null;
  try {
    const options = Object.fromEntries([...says].filter(([k]) => names.includes(k)));
    if (says.has('games')) terms = { ...cleanTerms(game.options, { options, rounds: Number(says.get('games')) }), ranked: says.get('ranked') === '1' };
  } catch { /* rules this version does not know: the player is asked about them later */ }
  return { game, code: first[1], terms, by: says.has('by') ? cleanName(says.get('by')) : '' };
}
export function inviteText({ game, code, server, terms, name }) {
  const link = inviteLink({ game, code, server, terms, name });
  return `Play ${game.name} with me on OpenGames!\n${link ? `Tap to play: ${link}\n` : ''}Or type this code in the app: ${code}`;
}
export const whatsappUrl = (text) => `https://wa.me/?text=${encodeURIComponent(text)}`;
