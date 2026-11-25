import { Session, cleanName } from './session.js';
import { createTable } from './table.js';
import { meet, link } from './wire.js';
import { settings, identity, record, addResult, lastTerms, saveTerms } from './store.js';
import { describe, drawChoices, readChoices, drawTerms, drawLeaderboard } from './rules.js';

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const node = Object.assign(document.createElement(tag), props); node.append(...kids); return node; };
const TEXT = {
  offline: 'The match server cannot be reached. Check your internet connection and try again.',
  expired: 'Nobody joined in time. Please try again.',
  no_match: 'There is no open match with that code, or your friend has a different version of the game.',
  bad_request: 'The match server did not accept that. Please try again.',
};
const SCREENS = ['library', 'setup', 'terms', 'board', 'wait', 'match'], IDLE_MS = 3 * 60 * 1000;
let server = '', stun = null, library = [], current = null;      // current: { game, meeting, session, table, over }

function screen(name) {
  document.body.dataset.screen = name;
  for (const id of SCREENS) $(id).hidden = id !== name;
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
    const code = el('input', { placeholder: 'Code', maxLength: 8, autocomplete: 'off', spellcheck: false });
    code.setAttribute('aria-label', `Match code for ${game.name}`);
    const join = el('form', { className: 'join', onsubmit: (e) => { e.preventDefault(); if (code.value.trim()) begin(game, { t: 'join', code: code.value.trim() }); } },
      code, el('button', { textContent: 'Join' }));
    return el('li', {}, el('img', { className: 'art', src: `/icons/${game.id}`, alt: '' }),
      el('div', {}, el('h3', { textContent: game.name }), el('p', { textContent: game.summary }),
        el('p', { className: 'facts', textContent: `2 players, about ${game.minutes} min. By ${game.author}, ${game.license} license.` }),
        el('p', { className: 'facts', textContent: r.wins + r.losses + r.draws ? `You won ${r.wins} and lost ${r.losses} on this computer.` : 'Not played yet.' })),
      el('div', { className: 'actions' },
        el('button', { className: 'go', type: 'button', textContent: 'Find a player', onclick: () => choose(game, { t: 'find' }) }),
        el('button', { type: 'button', textContent: 'Invite a friend', onclick: () => choose(game, { t: 'create' }) }), join,
        el('button', { type: 'button', textContent: 'Leaderboard', onclick: () => showLeaderboard(game) })));
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
/* The one who starts a match chooses the rules. Somebody who joins only sees them. */
let choosing = null;
function choose(game, ask) {
  if (current) return;
  choosing = { game, ask };
  $('setupTitle').textContent = game.name;
  $('setupText').textContent = ask.t === 'find' ? 'Choose the rules. If somebody else is already waiting, you see their rules and can accept them or leave.' : 'Choose the rules. Your friend sees them before the match.';
  $('setupGo').textContent = ask.t === 'find' ? 'Find a player' : 'Get a code';
  const last = lastTerms(game.id);
  drawChoices($('choices'), game, last);
  $('ranked').checked = last.ranked !== false;
  screen('setup');
  $('setupTitle').focus();
}
$('setupForm').onsubmit = (e) => {
  e.preventDefault();
  if (!choosing) return;
  const { game, ask } = choosing, terms = { ...readChoices($('choices')), ranked: $('ranked').checked };
  choosing = null;
  saveTerms(game.id, terms);
  begin(game, ask, terms);
};
$('setupBack').onclick = () => { choosing = null; screen('library'); };

/* Asked on the side of the one who joins, before anything about the board is known. */
function review(mine, { terms, name }) {
  return new Promise((resolve) => {
    $('termsTitle').textContent = mine.game.name;
    $('termsWho').textContent = `${name} organises this match with these rules.`;
    drawTerms($('termsList'), $('termsRules'), mine.game, terms);
    const answer = (isYes) => { $('termsYes').onclick = $('termsNo').onclick = null; if (current === mine) screen('match'); resolve(isYes); };
    $('termsYes').onclick = () => answer(true);
    $('termsNo').onclick = () => { answer(false); if (current === mine) leave(); };
    screen('terms');
    $('termsTitle').focus();
  });
}
async function showLeaderboard(game) {
  $('boardTitle').textContent = `${game.name} leaderboard`;
  $('boardRows').replaceChildren();
  $('boardText').textContent = 'Loading';
  $('boardTable').hidden = true;
  screen('board');
  $('boardTitle').focus();
  try {
    const [{ players }, me] = await Promise.all([desk.leaderboard(game.id), identity()]);
    if ($('boardTitle').textContent !== `${game.name} leaderboard`) return;
    $('boardText').textContent = players.length ? '' : 'Nobody has finished a ranked match yet.';
    $('boardTable').hidden = !players.length;
    drawLeaderboard($('boardRows'), players, me.pub);
  } catch {
    $('boardText').textContent = 'The leaderboard cannot be reached. Check your internet connection and try again.';
  }
}
$('boardBack').onclick = () => screen('library');
function begin(game, ask, terms = {}) {
  if (current) return;
  const mine = { game, terms };
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
  const [wire, me] = await Promise.all([link(met, { hideAddress: settings.hideAddress, iceServers: stun ? [{ urls: stun }] : [] }), identity()]);
  mine.wire = wire;
  if (!still()) { wire.close(); return; }
  mine.token = crypto.randomUUID();                    // messages of an earlier game are ignored
  mine.table = createTable({ send: (msg) => desk.toGame(mine.token, msg) });
  screen('match');
  $('mode').textContent = wire.mode === 'direct' ? 'Direct connection' : 'Through the server';
  $('status').textContent = 'Starting the game';
  $('leave').textContent = 'Leave';
  for (const id of ['p0', 'p1', 'score', 'rules']) $(id).textContent = '';
  await desk.openGame(mine.game.id, mine.token);
  if (!still()) return;
  await placeGame();
  await Promise.race([mine.table.ready, new Promise((_, no) => setTimeout(() => no(new Error('The game did not open.')), 10000))]);
  if (!still()) return;
  const terms = { ...mine.terms, ranked: !!mine.terms.ranked && !!met.ticket };
  if (met.host) $('status').textContent = 'Waiting for the other player to accept your rules';
  mine.session = new Session({ wire, terms, ticket: met.ticket, sound: settings.sound, table: mine.table, identity: me, host: met.host, game: mine.game, name: settings.name || 'Player', on: {
    terms: (offer) => review(mine, offer),
    started: ({ me: seat, players, terms: agreed }) => {
      if (!still()) return;
      screen('match');
      $('rules').textContent = describe(mine.game, agreed);
      mine.ranked = agreed.ranked; mine.rounds = agreed.rounds; mine.seat = seat; mine.heard = Date.now();
      drawScore(mine, [0, 0]);
      players.forEach((p, i) => { $(`p${i}`).textContent = `${p.name}${i === seat ? ' (you)' : ''}`; });
      $('status').textContent = 'Playing';
      $('leave').textContent = 'Give up';
      mine.started = true;
    },
    entry: ({ player }) => { if (player !== mine.seat) mine.heard = Date.now(); },
    ended: ({ score }) => drawScore(mine, score),
    over: ({ result, me: seat, transcript }) => finish(mine, result, seat, transcript),
    failed: (reason) => { if (!still()) return; if (mine.started) { stop(mine, reason); report(mine, mine.session.transcript()); } else leave(reason); },
  } });
  mine.table.onMove = (move) => mine.session.play(move);
  await mine.session.open();
}
function drawScore(mine, score) { $('score').textContent = mine.rounds > 1 ? `${score[0]} : ${score[1]}` : ''; }
/* A ranked match goes to the leaderboard, also when the other player left it. */
async function report(mine, transcript) {
  if (!mine.ranked || !transcript.entries.length) return;
  try {
    const out = await desk.submitResult(transcript);
    if (current !== mine || !out.finished) return;
    const points = out.counted ? out.points?.[mine.seat] : undefined;
    if (points !== undefined) $('status').textContent += ` ${points >= 0 ? '+' : '\u2212'}${Math.abs(points)} points.`;
    else if (!out.counted) $('status').textContent += ' It is on the leaderboard, or you two have played enough ranked matches for today.';
  } catch { if (current === mine) $('status').textContent += ' The leaderboard could not be reached.'; }
}
function finish(mine, result, seat, transcript) {
  mine.over = true;
  const outcome = result.winner === null ? 'draws' : result.winner === seat ? 'wins' : 'losses';
  addResult(mine.game.id, outcome);
  const words = { draws: 'It is a draw.', wins: result.reason === 'resigned' ? 'You win. The other player gave up.' : 'You win.', losses: result.reason === 'resigned' ? 'You gave up.' : 'You lose.' };
  $('status').textContent = words[outcome];
  drawScore(mine, result.score);
  report(mine, transcript);
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
  // Behind another screen the game has no size, so it cannot cover that screen.
  const { x, y, width, height } = $('match').hidden ? { x: 0, y: 0, width: 0, height: 0 } : $('stage').getBoundingClientRect();
  await desk.placeGame({ x, y, width, height });
}

$('leave').onclick = () => {
  if (!current) return;
  if (current.over || !current.started) leave();
  else if (Date.now() - current.heard > IDLE_MS) { const mine = current; mine.session.close(); stop(mine, 'The other player stopped playing.'); report(mine, mine.session.transcript()); }
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
function drawSound() { $('sound').textContent = settings.sound ? 'Sound on' : 'Sound off'; $('sound').setAttribute('aria-pressed', String(settings.sound)); }
$('sound').onclick = () => { settings.sound = !settings.sound; drawSound(); current?.table?.sound(settings.sound); };
drawSound();
({ server, stun, games: library } = await desk.games());
drawLibrary();
