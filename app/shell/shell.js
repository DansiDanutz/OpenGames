import { Session, cleanName } from './session.js';
import { createTable } from './table.js';
import { meet, link } from './wire.js';
import { settings, identity, record, addResult } from './store.js';

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const node = Object.assign(document.createElement(tag), props); node.append(...kids); return node; };
const TEXT = {
  offline: 'The match server cannot be reached. Check your internet connection and try again.',
  expired: 'Nobody joined in time. Please try again.',
  no_match: 'There is no open match with that code.',
  other_version: 'Your friend has a different version of this game.',
  bad_request: 'The match server did not accept that. Please try again.',
};
let server = '', library = [], current = null;      // current: { game, meeting, session, table, over }

function screen(name) {
  document.body.dataset.screen = name;
  for (const id of ['library', 'wait', 'match']) $(id).hidden = id !== name;
}
let noticeTimer;
function notice(text) {
  $('notice').textContent = text;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { $('notice').textContent = ''; }, 7000);
}
function drawLibrary() {
  $('games').replaceChildren(...library.map((game) => {
    const r = record(game.id);
    const code = el('input', { placeholder: 'Code', maxLength: 6, autocomplete: 'off', spellcheck: false });
    code.setAttribute('aria-label', `Match code for ${game.name}`);
    const join = el('form', { className: 'join', onsubmit: (e) => { e.preventDefault(); if (code.value.trim()) begin(game, { t: 'join', code: code.value.trim() }); } },
      code, el('button', { textContent: 'Join' }));
    return el('li', {},
      el('div', {}, el('h3', { textContent: game.name }), el('p', { textContent: game.summary }),
        el('p', { className: 'facts', textContent: `2 players, about ${game.minutes} min. By ${game.author}, ${game.license} license.` }),
        el('p', { className: 'facts', textContent: r.wins + r.losses + r.draws ? `You won ${r.wins} and lost ${r.losses} on this computer.` : 'Not played yet.' })),
      el('div', { className: 'actions' },
        el('button', { className: 'go', type: 'button', textContent: 'Find a player', onclick: () => begin(game, { t: 'find' }) }),
        el('button', { type: 'button', textContent: 'Invite a friend', onclick: () => begin(game, { t: 'create' }) }), join));
  }));
}
function waiting(title, text, code = '') {
  $('waitTitle').textContent = title;
  $('waitText').textContent = text;
  $('code').textContent = code;
  $('code').hidden = !code;
  if ($('wait').hidden) { screen('wait'); $('waitTitle').focus(); }
}
function leave(text) {
  const was = current;
  current = null;
  was?.meeting?.cancel();
  was?.session?.close();
  was?.wire?.close();
  desk.closeGame();
  drawLibrary();
  screen('library');
  if (text) notice(text);
}
function begin(game, ask) {
  if (current) return;
  const mine = { game };
  current = mine;
  const still = () => current === mine;
  waiting('Connecting', game.name);
  mine.meeting = meet({ url: server, key: `${game.id}@${game.hash}`, ask, on: {
    code: ({ code }) => still() && waiting('Send this code to your friend', `They open ${game.name} in OpenGames and type it.`, code),
    searching: () => still() && waiting('Looking for a player', `The match starts when somebody else wants to play ${game.name}.`),
    error: ({ error }) => still() && leave(TEXT[error] ?? TEXT.bad_request),
    closed: (reason) => still() && leave(TEXT[reason] ?? TEXT.offline),
    paired: (met) => { if (still()) play(mine, met, still).catch((error) => { if (still()) leave(error.message); }); },
  } });
}
async function play(mine, met, still) {
  waiting('Player found', 'Connecting your two computers.');
  const [wire, me] = await Promise.all([link(met, { hideAddress: settings.hideAddress }), identity()]);
  mine.wire = wire;
  if (!still()) { wire.close(); return; }
  mine.token = crypto.randomUUID();                    // messages of an earlier game are ignored
  mine.table = createTable({ send: (msg) => desk.toGame(mine.token, msg) });
  screen('match');
  $('mode').textContent = wire.mode === 'direct' ? 'Direct connection' : 'Through the server';
  $('status').textContent = 'Starting the game';
  $('leave').textContent = 'Leave';
  $('p0').textContent = $('p1').textContent = '';
  await desk.openGame(mine.game.id, mine.token);
  if (!still()) return;
  await placeGame();
  await Promise.race([mine.table.ready, new Promise((_, no) => setTimeout(() => no(new Error('The game did not open.')), 10000))]);
  if (!still()) return;
  mine.session = new Session({ wire, table: mine.table, identity: me, host: met.host, game: mine.game, name: settings.name || 'Player', on: {
    started: ({ me: seat, players }) => {
      players.forEach((p, i) => { $(`p${i}`).textContent = `${p.name}${i === seat ? ' (you)' : ''}`; });
      $('status').textContent = 'Playing';
      $('leave').textContent = 'Give up';
      mine.started = true;
    },
    over: ({ result, me: seat }) => finish(mine, result, seat),
    failed: (reason) => still() && stop(mine, reason),
  } });
  mine.table.onMove = (move) => mine.session.play(move);
  await mine.session.open();
}
function finish(mine, result, seat) {
  mine.over = true;
  const outcome = result.winner === null ? 'draws' : result.winner === seat ? 'wins' : 'losses';
  addResult(mine.game.id, outcome);
  const words = { draws: 'It is a draw.', wins: result.reason === 'resigned' ? 'You win. The other player gave up.' : 'You win.', losses: result.reason === 'resigned' ? 'You gave up.' : 'You lose.' };
  $('status').textContent = words[outcome];
  $('leave').textContent = 'Back to games';
  $('leave').focus();
}
/* A lost match stays on the screen, so the player can read why. It does not count. */
function stop(mine, reason) {
  mine.over = true;
  $('status').textContent = `${reason} This match does not count.`;
  $('leave').textContent = 'Back to games';
}
async function placeGame() {
  if ($('match').hidden) return;
  const { x, y, width, height } = $('stage').getBoundingClientRect();
  await desk.placeGame({ x, y, width, height });
}

$('leave').onclick = () => {
  if (!current) return;
  if (current.over || !current.started) leave();
  else current.session.play({ $: 'resign' });
};
$('cancel').onclick = () => leave();
$('nameForm').onsubmit = (e) => { e.preventDefault(); $('name').blur(); };
$('name').onchange = () => { settings.name = $('name').value; $('name').value = settings.name; };
$('hide').onchange = () => { settings.hideAddress = $('hide').checked; };
addEventListener('resize', placeGame);
new ResizeObserver(placeGame).observe($('stage'));
desk.onGame((token, msg) => { if (current?.token && current.token === token) current.table.receive(msg); });
desk.onGameGone(() => { if (current && !current.over) { current.session?.close(); current.wire?.close(); stop(current, 'The game stopped working.'); } });

if (!settings.name) settings.name = cleanName(`Player ${Math.floor(1000 + Math.random() * 9000)}`);
$('name').value = settings.name;
$('hide').checked = settings.hideAddress;
({ server, games: library } = await desk.games());
drawLibrary();
