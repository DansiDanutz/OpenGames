import { Session, cleanName } from './session.js';
import { Solo } from './solo.js';
import { createTable } from './table.js';
import { meet, link } from './wire.js';
import { settings, identity, record, soloKey, addResult, lastTerms, saveTerms, myRoom } from './store.js';
import { readInvite } from './invite.js';
import { cleanTerms } from '/kit/engine.js';
import { describe, drawChoices, readChoices, drawTerms, drawLeaderboard } from './rules.js';

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const node = Object.assign(document.createElement(tag), props); node.append(...kids); return node; };
const TEXT = {
  offline: 'The match server cannot be reached. Check your internet connection and try again.',
  expired: 'Nobody joined in time. Please try again.',
  left: 'The other player left.',
  taken: 'This game is open in another tab.',
  gone: 'That game has ended.',
  no_match: 'There is no open match with that code, or your friend has a different version of the game.',
  too_many: 'You met many players in a short time. Please wait a minute and try again.',
  bad_request: 'The match server did not accept that. Please try again.',
};
const SCREENS = ['library', 'room', 'terms', 'board', 'invited', 'wait', 'match'], IDLE_MS = 3 * 60 * 1000, RETRY_MS = 1500, MAX_TRIES = 20;
let server = '', stun = null, library = [], current = null;      // current: { game, meeting, session, table, wire, over }

/* While nothing happens a phone leaves the line out. */
function say(text) { $('status').textContent = text; $('status').classList.toggle('calm', text === 'Playing'); }
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
/* A winner's stand. */
function podium() {
  const make = (tag, props) => { const node = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(props)) node.setAttribute(k, v); return node; };
  const svg = make('svg', { viewBox: '0 0 18 16', 'aria-hidden': 'true' });
  svg.append(make('path', { d: 'M0 15V8.5Q0 8 .5 8H5v7zM6.5 15V2.5Q6.5 2 7 2h4q.5 0 .5.5V15zM13 15v-5h4.5q.5 0 .5.5V15z' }));
  return svg;
}
const played = (r, where) => (r.wins + r.losses + r.draws ? `You won ${r.wins} and lost ${r.losses} ${where}.` : '');
function creatorLines(game) {
  const open = (kind) => () => desk.openLink(game.id, kind).catch(() => notice('The browser did not open.'));
  return [
    ...(game.support ? [el('button', { type: 'button', className: 'link', textContent: 'Support the creator', ariaLabel: `Support the creator of ${game.name}`, onclick: open('support') })] : []),
    ...(game.sponsor ? [el('p', { className: 'sponsor' }, el('span', { textContent: 'Sponsor' }),
      el('button', { type: 'button', className: 'link', textContent: `${game.sponsor.name}: ${game.sponsor.text}`, onclick: open('sponsor') }))] : []),
  ];
}
function drawLibrary() {
  $('games').replaceChildren(...library.map((game) => {
    const history = [played(record(game.id), 'on this computer'), played(record(soloKey(game.id)), 'against the computer')].filter(Boolean).join(' ');
    return el('li', {}, el('img', { className: 'art', src: `/icons/${game.id}`, alt: '' }),
      el('div', { className: 'about' }, el('h3', { textContent: game.name }), el('p', { textContent: game.summary }),
        el('p', { className: 'facts', textContent: `1 or 2 players, about ${game.minutes} min. By ${game.author}, ${game.license} license.` }),
        el('p', { className: 'facts', textContent: history || 'Not played yet.' }), ...creatorLines(game)),
      el('div', { className: 'actions' }, el('button', { className: 'go', type: 'button', textContent: 'Play', ariaLabel: `Play ${game.name}`, onclick: () => enter(game) })),
      el('button', { type: 'button', className: 'ranks', onclick: () => showLeaderboard(game) }, podium(), 'Leaderboard'));
  }));
}
const SHARED = { whatsapp: 'WhatsApp is opening. Choose your friend there and send it.', message: 'The invite is copied.', code: 'The code is copied.' };
for (const button of document.querySelectorAll('#share button')) {
  button.onclick = async () => {
    const { how } = button.dataset, mine = current;
    try {
      await desk.invite(mine.game.id, mine.code, how, { terms: mine.terms, name: settings.name });
      $('shared').textContent = SHARED[how];
    } catch { $('shared').textContent = `That did not work. You can send this code: ${mine.code}`; }
  };
}
function waiting(title, text) {
  $('waitTitle').textContent = title;
  $('waitText').textContent = text;
  if ($('wait').hidden) { screen('wait'); $('waitTitle').focus(); }
}
function leave(text) {
  const was = current;
  current = null;
  myRoom.value = null;
  was?.meeting?.cancel();
  was?.session?.close();
  was?.wire?.close();
  desk.closeGame();
  drawLibrary();
  screen('library');
  if (text) notice(text);
}
/* A player is in the game first. The room is open at once, so that one tap sends the invite; whoever opened it chooses
   the rules. */
function readRules(game) {
  const terms = { ...readChoices($('choices')), ranked: $('ranked').checked };
  saveTerms(game.id, terms);
  $('roomTerms').textContent = describe(game, terms);
  return terms;
}
function drawRoom(game) {
  $('roomTitle').textContent = game.name;
  $('roomArt').src = `/icons/${game.id}`;
  $('joinCode').value = $('shared').textContent = '';
  $('share').hidden = true;
  $('roomRules').open = false;
  const last = lastTerms(game.id);
  drawChoices($('choices'), game, last);
  $('ranked').checked = last.ranked !== false;
  screen('room');
  $('roomTitle').focus();
}
function enter(game, ask = { t: 'create' }) {
  if (current) return;
  drawRoom(game);
  $('roomText').textContent = 'Opening your game';
  begin(game, ask, readRules(game));
}
/* From the room to something else: the room closes, the game stays. */
function instead(then) {
  if (!current) return;
  const { game } = current, terms = readRules(game);
  leave();
  then(game, terms);
}
$('choicesForm').onchange = () => { if (current) current.terms = readRules(current.game); };
$('choicesForm').onsubmit = (e) => e.preventDefault();
$('solo').onclick = () => instead((game, terms) => playAlone(game, terms));
$('find').onclick = () => instead((game, terms) => begin(game, { t: 'find' }, terms));
$('joinForm').onsubmit = (e) => { e.preventDefault(); const code = $('joinCode').value.trim(); if (code) instead((game) => begin(game, { t: 'join', code })); };
$('roomBack').onclick = () => leave();

/* The same rules again, or the rules of the link, need no second question. */
const sameRules = (a, b) => !!a && a.rounds === b.rounds && Object.keys(b.options).every((k) => a.options[k] === b.options[k]) && (a.ranked || !b.ranked);
/* Asked on the side of the one who joins, before anything about the board is known. */
async function review(mine, { terms, name }) {
  mine.them = name;
  if (sameRules(mine.accepted, terms)) return true;
  const isAgreed = await askRules(mine, { terms, name });
  if (isAgreed) mine.accepted = terms;
  return isAgreed;
}
function askRules(mine, { terms, name }) {
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
async function begin(game, ask, terms = {}, accepted = null, matchNo = 0) {
  if (current) return;
  const mine = { game, terms, accepted, matchNo, tries: 0 };
  current = mine;
  const still = () => current === mine;
  if (ask.t !== 'create') waiting('Connecting', game.name);
  const { pub } = await identity();
  if (!still()) return;
  const when = (fn) => (msg) => { if (still()) fn(msg); };
  const meeting = mine.meeting = meet({ url: server, key: `${game.id}@${game.hash}`, ask: { ...ask, pub }, on: {
    seat: when(({ back, met }) => {
      mine.hasRoom = true;
      mine.back = back;
      keep(mine);
      if (met && !mine.isLive && !(mine.over && mine.started)) meeting.link();   // this page was asleep, or was thrown away and came back
      if (mine.over && mine.iAsk) meeting.again();       // the server forgets a question when the line is cut
    }),
    code: when(({ code }) => {
      mine.code = $('code').textContent = code;
      if ($('room').hidden && !mine.met) drawRoom(game);
      $('roomText').textContent = 'Your game is open. It starts when your friend taps the invite.';
      $('share').hidden = false;
    }),
    waiting: when(() => waiting('Your friend is on the way', 'Your friend has left OpenGames for a moment. The match starts when they come back.')),
    searching: when(() => waiting('Looking for a player', `The match starts when somebody else wants to play ${game.name}.`)),
    error: when(({ error }) => leave(TEXT[error] ?? TEXT.bad_request)),
    closed: when((reason) => closed(mine, reason === 'expired' && ask.t === 'back' && !mine.back ? 'gone' : reason)),
    cut: when(() => { if (mine.code && !mine.met) $('roomText').textContent = 'Connecting again'; }),
    away: when(() => { if (mine.started && !mine.over && !mine.isLive) say(`${theirName(mine)} left the app for a moment. The match waits.`); }),
    here: when(() => { if (!mine.isLive && !mine.over) meeting.link(); }),
    link: when(() => { mine.isLive = false; meeting.link(); }),
    again: when(() => { mine.theyAsk = true; if (mine.over && !mine.iAsk) say(`${theirName(mine)} wants to play again.`); }),
    paired: when((met) => { mine.met = true; mine.hasRoom = true; play(mine, met, still); }),
  } });
}
/* For a page that a phone throws away: the room, and which of its matches this page had begun. */
const keep = (mine) => { myRoom.value = { game: mine.game.id, hash: mine.game.hash, back: mine.back, terms: mine.terms, accepted: mine.accepted, matchNo: mine.matchNo }; };
const theirName = (mine) => mine.them ?? 'The other player';
/* The room is gone: the other player left it, or it waited too long. */
function closed(mine, reason) {
  mine.hasRoom = false;
  myRoom.value = null;
  $('again').hidden = true;
  if (mine.code && !mine.met && reason === 'offline') { $('roomText').textContent = TEXT.offline; $('share').hidden = true; return; }
  if (!mine.met && !$('room').hidden && reason === 'offline') { $('roomText').textContent = 'You are offline. You can play alone.'; return; }
  if (!mine.started) { leave(TEXT[reason] ?? TEXT.offline); return; }
  if (mine.over) { if (reason === 'left') $('status').textContent += ` ${theirName(mine)} left.`; return; }
  if (reason === 'expired' && mine.isLive) return;       // a direct match does not need the server
  const { session } = mine;
  session.close();
  stop(mine, reason === 'left' ? `${theirName(mine)} left.` : reason === 'taken' ? TEXT.taken : 'The connection was lost.');
  report(mine, session.transcript());
}
/* Opens the game's page and waits until it answers. False when the player left in the meantime. */
async function openTable(mine, mode, still) {
  mine.token = crypto.randomUUID();                    // messages of an earlier game are ignored
  mine.table = createTable({ send: (msg) => desk.toGame(mine.token, msg) });
  screen('match');
  $('mode').textContent = mode;
  say('Starting the game');
  $('leave').textContent = 'Leave';
  $('again').hidden = true;
  for (const id of ['p0', 'p1', 'score', 'rules']) $(id).textContent = '';
  await desk.openGame(mine.game.id, mine.token);
  if (!still()) return false;
  await placeGame();
  await Promise.race([mine.table.ready, new Promise((_, no) => setTimeout(() => no(new Error('The game did not open.')), 10000))]);
  return still();
}
/* What happens during a match, the same with a person and with the computer. */
const during = (mine, still) => ({
  started: ({ me: seat, players, terms: agreed }) => {
    if (!still()) return;
    screen('match');
    $('rules').textContent = describe(mine.game, agreed, mine.solo);
    mine.ranked = agreed.ranked; mine.rounds = agreed.rounds; mine.seat = seat; mine.heard = Date.now();
    drawScore(mine, [0, 0]);
    players.forEach((p, i) => { $(`p${i}`).textContent = `${p.name}${i === seat ? ' (you)' : ''}`; });
    say('Playing');
    $('leave').textContent = 'Give up';
    mine.started = true; mine.over = mine.iAsk = mine.theyAsk = false;
    if (mine.solo) return;
    mine.them = players[1 - seat].name;
    mine.matchNo = mine.nextNo;
    keep(mine);
  },
  entry: ({ player }) => { if (player !== mine.seat) mine.heard = Date.now(); },
  ended: ({ score }) => drawScore(mine, score),
  over: ({ result, me: seat, transcript }) => finish(mine, result, seat, transcript),
  lost: () => { if (!still()) return; mine.isLive = false; say('The connection was lost. Connecting again.'); mine.meeting.link(); },
  resumed: () => { if (!still()) return; mine.isLive = true; mine.heard = Date.now(); if (!mine.over) say('Playing'); },
  failed: (reason) => {
    if (!still()) return;
    if (mine.hasRoom && !mine.started && reason === 'The connection was lost.') { waiting('Connecting again', mine.game.name); mine.meeting.link(); return; }
    if (!mine.started) { leave(reason); return; }
    stop(mine, reason);
    if (!mine.solo) report(mine, mine.session.transcript());
  },
});
/* Without a server or another person. */
async function playAlone(game, terms) {
  if (current) return;
  const mine = { game, terms, solo: true };
  current = mine;
  const still = () => current === mine;
  try {
    if (!(await openTable(mine, 'Against the computer', still))) return;
    mine.session = new Solo({ table: mine.table, game, terms, name: settings.name || 'Player', sound: settings.sound, on: during(mine, still) });
    mine.table.onMove = (move) => mine.session.play(move);
    await mine.session.open();
  } catch (error) { if (still()) leave(error.message); }
}
/* The server introduced the two again and again: for the first match, after a lost line, and for another match. */
async function play(mine, met, still) {
  const isMidMatch = mine.started && !mine.over;
  mine.wire?.close();
  mine.wire = null;
  if (!mine.started) waiting('Player found', 'Connecting your two computers.');
  const turn = mine.turn = {}, isNow = () => still() && mine.turn === turn;
  const isSame = met.match === mine.matchNo, have = isSame ? mine.session?.match ?? null : null;
  try {
    const [wire, me] = await Promise.all([link(met, { have, hideAddress: settings.hideAddress, iceServers: stun ? [{ urls: stun }] : [] }), identity()]);
    if (!isNow()) { wire.close(); return; }
    mine.wire = wire;
    mine.tries = 0;
    const mode = wire.mode === 'direct' ? 'Direct connection' : 'Through the server';
    if (have && wire.theirs === have) { $('mode').textContent = mode; await mine.session.resume(wire); }
    else if (isSame || wire.theirs) pageGone(mine, isMidMatch);
    else { await playNew(mine, met, { wire, me, mode, still, isNow }); return; }
    if (mine.over && mine.iAsk) mine.meeting.again();
  } catch (error) {
    if (!isNow()) return;
    if (mine.wire && !mine.started) { leave(error.message); return; }
    retry(mine, isNow);
  }
}
/* The line did not come about: once more, but not for ever. */
function retry(mine, isNow) {
  if (++mine.tries <= MAX_TRIES) { setTimeout(() => { if (isNow()) mine.meeting.link(); }, RETRY_MS); return; }
  if (!mine.started) { leave('Your two computers could not be connected. Please try again.'); return; }
  if (!mine.over) say('The connection could not be brought back. You can leave the match.');
}
/* One of the two pages was closed and has lost the match. The room is still there. */
function pageGone(mine, isMidMatch) {
  if (mine.over) return;
  if (isMidMatch) {
    const { session } = mine;
    stop(mine, `${theirName(mine)} lost the match when the app closed.`);
    report(mine, session.transcript());
    session.close();
    return;
  }
  mine.started = mine.over = true;
  screen('match');
  say('Your match ended when this page closed.');
  offerAgain(mine);
}
async function playNew(mine, met, { wire, me, mode, still, isNow }) {
  mine.session?.close();
  mine.started = false;
  mine.isLive = true;
  if (!(await openTable(mine, mode, isNow))) return;
  mine.nextNo = met.match;
  const terms = { ...mine.terms, ranked: !!mine.terms.ranked && !!met.ticket };
  if (met.host) say('Waiting for the other player to accept your rules');
  const isMine = () => still() && mine.session === session;   // also after the line came back
  const session = mine.session = new Session({ wire, terms, ticket: met.ticket, theirPub: met.theirPub, sound: settings.sound, table: mine.table, identity: me, host: met.host, game: mine.game, name: settings.name || 'Player', on: {
    terms: (offer) => review(mine, offer),
    ...during(mine, isMine),
  } });
  mine.table.onMove = (move) => session.play(move);
  await session.open();
}
function offerAgain(mine) {
  $('leave').textContent = 'Back to games';
  $('again').hidden = !(mine.solo || mine.hasRoom);
  if (mine.theyAsk) say(`${theirName(mine)} wants to play again.`);
}
$('again').onclick = () => {
  const mine = current;
  if (!mine?.over) return;
  if (mine.solo) { leave(); playAlone(mine.game, mine.terms); return; }
  mine.iAsk = true;
  $('again').hidden = true;
  say(`Waiting for ${theirName(mine)}`);
  mine.meeting.again();
};
function drawScore(mine, score) { $('score').textContent = mine.rounds > 1 ? `${score[0]} : ${score[1]}` : ''; }
/* A ranked match goes to the leaderboard, also when the other player left it. */
async function report(mine, transcript) {
  if (!mine.ranked || !transcript.entries.length) return;
  try {
    const out = await desk.submitResult(transcript);
    if (current !== mine || !out.finished) return;
    const points = out.counted ? out.points?.[mine.seat] : undefined;
    if (points !== undefined) $('status').textContent += ` ${points >= 0 ? '+' : '\u2212'}${Math.abs(points)} points.`;
    else if (!out.counted) $('status').textContent += ' You two have played enough ranked matches for today, so it adds no points.';
  } catch { if (current === mine) $('status').textContent += ' The leaderboard could not be reached.'; }
}
function finish(mine, result, seat, transcript) {
  mine.over = true;
  const outcome = result.winner === null ? 'draws' : result.winner === seat ? 'wins' : 'losses';
  addResult(mine.solo ? soloKey(mine.game.id) : mine.game.id, outcome);
  const words = { draws: 'It is a draw.', wins: result.reason === 'resigned' ? 'You win. The other player gave up.' : 'You win.', losses: result.reason === 'resigned' ? 'You gave up.' : 'You lose.' };
  say(words[outcome]);
  drawScore(mine, result.score);
  report(mine, transcript);
  offerAgain(mine);
  ($('again').hidden ? $('leave') : $('again')).focus();
}
/* A lost match stays on the screen, so the player can read why. It does not count. */
function stop(mine, reason) {
  mine.over = true;
  say(`${reason} This match does not count.`);
  mine.meeting?.isOpen() || (mine.hasRoom = false);
  offerAgain(mine);
}
async function placeGame() {
  // Behind another screen the game has no size, so it cannot cover that screen.
  const { x, y, width, height } = $('match').hidden ? { x: 0, y: 0, width: 0, height: 0 } : $('stage').getBoundingClientRect();
  await desk.placeGame({ x, y, width, height });
}

$('leave').onclick = () => {
  if (!current) return;
  if (current.over || !current.started) leave();
  else if (!current.solo && (!current.isLive || Date.now() - current.heard > IDLE_MS)) { const mine = current; mine.session.close(); mine.meeting.cancel(); mine.hasRoom = false; stop(mine, current.isLive ? 'The other player stopped playing.' : 'You left while the connection was lost.'); report(mine, mine.session.transcript()); }
  else current.session.play({ $: 'resign' });
};
$('cancel').onclick = () => leave();
$('nameForm').onsubmit = (e) => { e.preventDefault(); $('name').blur(); };
$('name').onchange = () => { settings.name = $('name').value; $('name').value = settings.name; };
$('hide').onchange = () => { settings.hideAddress = $('hide').checked; };
addEventListener('resize', placeGame);
new ResizeObserver(placeGame).observe($('stage'));
desk.onGame((token, msg) => { if (current?.token && current.token === token) current.table.receive(msg); });
desk.onGameGone(() => { if (current && !current.over) { current.session?.close(); current.wire?.close(); current.meeting?.cancel(); current.hasRoom = false; stop(current, 'The game stopped working.'); } });

if (!settings.name) settings.name = cleanName(`Player ${Math.floor(1000 + Math.random() * 9000)}`);
$('name').value = settings.name;
$('hide').checked = settings.hideAddress;
function drawSound() { $('sound').textContent = settings.sound ? 'Sound on' : 'Sound off'; $('sound').setAttribute('aria-pressed', String(settings.sound)); }
$('sound').onclick = () => { settings.sound = !settings.sound; drawSound(); current?.table?.sound(settings.sound); };
drawSound();
({ server, stun, games: library } = await desk.games());
drawLibrary();
/* Saved rules, or null when they are not rules of this game. */
function rulesOf(game, terms) {
  try { return terms && { ...cleanTerms(game.options, { ...terms, ranked: false, ticket: null }), ranked: terms.ranked === true }; } catch { return null; }
}
/* A link from an invite. A link alone connects nobody: the other player would learn this player's address. */
const invite = readInvite(location.hash, library);
if (location.hash) history.replaceState(null, '', location.pathname);
const saved = myRoom.value, savedGame = saved && library.find((g) => g.id === saved.game && g.hash === saved.hash);
myRoom.value = null;
if (invite) {
  const { game, code, terms, by } = invite;
  $('invitedTitle').textContent = game.name;
  $('invitedText').textContent = `${by || 'A friend'} invites you to play.`;
  $('invitedArt').src = `/icons/${game.id}`;
  $('invitedTerms').hidden = !terms;
  drawTerms($('invitedTerms'), $('invitedRules'), game, terms ?? cleanTerms(game.options, {}));
  $('invitedYes').onclick = () => begin(game, { t: 'join', code }, {}, terms);
  $('invitedNo').onclick = () => screen('library');
  screen('invited');
  $('invitedTitle').focus();
} else if (savedGame) begin(savedGame, { t: 'back', back: saved.back }, rulesOf(savedGame, saved.terms) ?? lastTerms(savedGame.id), rulesOf(savedGame, saved.accepted), saved.matchNo);
