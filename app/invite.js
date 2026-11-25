/* What a player sends to a friend: the game, the code and where the game is shown. */
const CODE = /^[A-HJ-NP-Z2-9]{8}$/;                       // what the match server gives out
export const isCode = (v) => typeof v === 'string' && CODE.test(v);

export function inviteText({ game, code, server }) {
  if (!isCode(code)) throw new Error('not a code');
  const url = new URL(server);
  const where = url.protocol === 'wss:' ? ` https://${url.host}/games/${game.id}` : '';
  return `Play ${game.name} with me on OpenGames! In the app, type this code at ${game.name} and press Join: ${code}\nIt works for 10 minutes while I wait.${where}`;
}
export const whatsappUrl = (text) => `https://wa.me/?text=${encodeURIComponent(text)}`;
