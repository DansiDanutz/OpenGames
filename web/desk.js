/* What the app's main process does on a computer, done by the browser: opens games in a locked frame, asks the
   match server, copies invites, and offers to install the app. */
import { inviteText, whatsappUrl } from '/app/invite.js';

const MAX_MESSAGE = 32 * 1024, MAX_PER_SECOND = 200;
let library = [], frame = null, token = null, second = 0, used = 0;
let onGame = () => {}, onGone = () => {};

const find = (id) => {
  const game = library.find((g) => g.id === id);
  if (!game) throw new Error('unknown game');
  return game;
};
async function ask(where, init = {}, ms = 15_000) {
  const res = await fetch(where, { ...init, signal: AbortSignal.timeout(ms), credentials: 'omit', redirect: 'error' });
  if (!res.ok && res.status !== 422) throw new Error(`the server answered ${res.status}`);
  return res.json();
}
function closeGame() {
  frame?.remove();
  frame = token = null;
}
addEventListener('message', (event) => {
  if (!frame || event.source !== frame.contentWindow) return;
  const now = Math.floor(Date.now() / 1000);
  if (now !== second) { second = now; used = 0; }
  if (++used > MAX_PER_SECOND) { closeGame(); onGone(); return; }
  if (typeof event.data !== 'string' || event.data.length > MAX_MESSAGE) return;
  let msg;
  try { msg = JSON.parse(event.data); } catch { return; }
  onGame(token, msg);
});

globalThis.desk = {
  async games() {
    const answer = await ask('/web/games.json');
    library = answer.games;
    return { server: `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/`, stun: answer.stunPort ? `stun:${location.hostname}:${answer.stunPort}` : null, games: library };
  },
  async openGame(id, mine) {
    const game = find(id);
    closeGame();
    frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.title = game.name;
    frame.className = 'game';
    frame.src = `/table/${game.id}/${game.page}`;
    token = mine;
    // A frame that loads a second time tried to go somewhere else.
    let loads = 0;
    const own = frame;
    own.onload = () => { if (++loads > 1 && own === frame) { closeGame(); onGone(); } };
    document.body.append(frame);
  },
  async closeGame() { closeGame(); },
  async placeGame({ x, y, width, height }) {
    if (frame) Object.assign(frame.style, { left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px` });
  },
  async toGame(mine, msg) { if (frame && mine === token) frame.contentWindow.postMessage(msg, '*'); },
  submitResult: (transcript) => ask(`/result?ticket=${encodeURIComponent(transcript.terms.ticket)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(transcript) }, 60_000),
  accountOn: async () => (await ask('/account')).on === true,
  async account(action, body) {
    const res = await fetch(`/account/${encodeURIComponent(action)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000), credentials: 'omit', redirect: 'error' });
    return { ok: res.ok, body: await res.json() };
  },
  leaderboard: (id) => ask(`/leaderboard?game=${find(id).id}`),
  async openLink(id, kind) {
    const game = find(id), url = kind === 'support' ? game.support : game.sponsor?.url;
    if (!url) throw new Error('unknown link');
    if (confirm(`Open ${new URL(url).hostname}?\n\n${url}\n\nThis page does not belong to OpenGames.`)) open(url, '_blank', 'noopener,noreferrer');
  },
  async invite(id, code, how) {
    const text = inviteText({ game: find(id), code, server: location.origin });
    if (how === 'whatsapp') open(whatsappUrl(text), '_blank', 'noopener,noreferrer');
    else await navigator.clipboard.writeText(how === 'code' ? code : text);
  },
  onGame(fn) { onGame = fn; },
  onGameGone(fn) { onGone = fn; },
};

/* The name and the key of a player stay in this browser, so nobody signs in again. */
navigator.storage?.persist?.().catch(() => {});

/* Chrome and Android offer to install the app; on an iPhone the person does it from the Share menu. */
const isInstalled = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isApple = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const install = document.getElementById('install');
const help = document.getElementById('installHelp');
let offer = null;
addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); offer = event; install.hidden = isInstalled; });
addEventListener('appinstalled', () => { install.hidden = help.hidden = true; });
install.hidden = isInstalled || !isApple;
install.onclick = async () => {
  if (!offer) { help.hidden = !help.hidden; return; }
  const asked = offer;
  offer = null;
  await asked.prompt();
  install.hidden = (await asked.userChoice).outcome === 'accepted';
};
