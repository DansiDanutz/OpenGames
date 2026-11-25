/* What a player sends to a friend: the game, the code and a link that joins. */
const CODE = /^[A-HJ-NP-Z2-9]{8}$/;                       // what the match server gives out
export const isCode = (v) => typeof v === 'string' && CODE.test(v);

export function inviteText({ game, code, server }) {
  if (!isCode(code)) throw new Error('not a code');
  const url = new URL(server);
  const link = ['wss:', 'https:'].includes(url.protocol) ? `Tap to play: https://${url.host}/play#${game.id}=${code}\n` : '';
  return `Play ${game.name} with me on OpenGames!\n${link}Or type this code in the app: ${code}\nIt works for 10 minutes.`;
}
export const whatsappUrl = (text) => `https://wa.me/?text=${encodeURIComponent(text)}`;
