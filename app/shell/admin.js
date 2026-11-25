/* The admin view: visits, matches, accounts and GitHub, from the server's signed answer (server/admin.js).
   Everything from the server is set as text, never as markup. Links go to GitHub only. */
const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const node = Object.assign(document.createElement(tag), props); node.append(...kids); return node; };
const GITHUB = 'https://github.com/';
const OWNER_PAGE = /^https:\/\/github\.com\/DansiDanutz\/OpenGames-creators\/settings\/access$/;
const PAGE_NAMES = { '/': 'Home', '/play': 'Play', '/creators': 'Creators' };

const isNumber = (v) => Number.isSafeInteger(v) && v >= 0;
const number = (v) => (isNumber(v) ? v.toLocaleString('en-US') : '–');
const day = (iso) => (typeof iso === 'string' ? new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '–');
const list = (v) => (Array.isArray(v) ? v : []);
const pageName = (page) => PAGE_NAMES[page] ?? (typeof page === 'string' ? page.replace(/^\/games\//, 'Game: ') : '');
function link(url, text) {
  if (typeof url !== 'string' || !url.startsWith(GITHUB)) return document.createTextNode(text);
  return el('a', { href: url, target: '_blank', rel: 'noopener noreferrer', textContent: text });
}

function tiles(pairs) {
  return el('dl', { className: 'tiles' }, ...pairs.map(([label, value]) => el('div', {}, el('dt', { textContent: label }), el('dd', { textContent: number(value) }))));
}
/* head: column names. rows: arrays of cells, each text or a node. */
function table(caption, head, rows) {
  const cell = (tag, v) => el(tag, tag === 'th' ? { scope: 'col' } : {}, typeof v === 'string' ? document.createTextNode(v) : v);
  return el('div', { className: 'scroll' }, el('table', {},
    el('caption', { className: 'small', textContent: caption }),
    el('thead', {}, el('tr', {}, ...head.map((h) => cell('th', h)))),
    el('tbody', {}, ...rows.map((r) => el('tr', {}, ...r.map((v) => cell('td', v)))))));
}
const section = (title, ...kids) => [el('h2', { textContent: title }), ...kids];
const note = (text) => el('p', { className: 'small', textContent: text });

function visits(report) {
  const v = report.visits;
  if (!v) return section('Visits', note('This server does not count visits.'));
  const days = list(v.days), most = Math.max(1, ...days.map((d) => (isNumber(d.total) ? d.total : 0)));
  const bar = (n) => el('meter', { min: 0, max: most, value: isNumber(n) ? n : 0, ariaHidden: 'true' });
  return section('Visits',
    note(`Each page shown counts once, one number per page and UTC day${report.since ? `, since ${day(report.since)}` : ''}.`),
    table('Visits per day, newest first', ['Day', 'Visits', ''], days.toReversed().map((d) => [day(d.day), number(d.total), bar(d.total)])),
    table('Visits per page', ['Page', 'Today', '7 days', '30 days'], list(v.pages).map((p) => [pageName(p.page), number(p.today), number(p.week), number(p.month)])));
}
function matches(report) {
  return section('Matches per game',
    table('Matches between two players; play against the computer is not counted', ['Game', 'Today', '7 days', '30 days', 'All time', 'Ranked players'],
      list(report.games).map((g) => [String(g.name ?? g.id ?? ''), number(g.today), number(g.week), number(g.month), number(g.total), number(g.ranked)])));
}
const gamesOf = (p) => (Array.isArray(p.games) ? p.games.join(', ') || 'none' : 'unknown');
function github(report) {
  const gh = report.github;
  if (!gh) return section('GitHub', note(`GitHub facts are not available: ${String(report.reason ?? 'unknown')}.`));
  const room = typeof gh.creatorsRoom === 'string' && OWNER_PAGE.test(gh.creatorsRoom) ? gh.creatorsRoom : null;
  const invite = (p) => (p.invite === true && room ? link(room, `Invite ${p.author} to the Creators room`) : '');
  return section('GitHub',
    el('p', {}, link(gh.url, String(gh.repo ?? 'The repository'))),
    table('Open pull requests, newest first (at most 20)', ['#', 'Title', 'By', 'Opened', 'Games'],
      list(gh.open).map((p) => [number(p.number), link(p.url, String(p.title ?? '')), String(p.author ?? '–'), day(p.createdAt), gamesOf(p)])),
    table('Recently merged pull requests (last 10)', ['#', 'Title', 'By', 'Merged', 'Creators room'],
      list(gh.merged).map((p) => [number(p.number), link(p.url, String(p.title ?? '')), String(p.author ?? '–'), day(p.mergedAt), invite(p)])),
    note('An invite is sent by hand on GitHub, on the page of the Creators room.'));
}
function draw(report) {
  const last = list(report.visits?.days), gh = report.github;
  return [
    tiles([['Visits today', last.at(-1)?.total], ['Visits, 30 days', report.visits ? last.reduce((n, d) => n + (isNumber(d.total) ? d.total : 0), 0) : null], ['Accounts', report.accounts], ['Ranked players', report.ranked],
      ['Stars', gh?.stars], ['Forks', gh?.forks], ['Watchers', gh?.watchers], ['Open pull requests', gh ? list(gh.open).length : null]]),
    ...visits(report), ...matches(report), ...github(report),
  ];
}

/* load(): the signed request for the report. show(): brings the admin screen. */
export async function showAdmin({ load, show }) {
  $('adminText').textContent = 'Loading';
  $('adminBody').replaceChildren();
  show();
  try {
    const report = await load();
    $('adminText').textContent = '';
    $('adminBody').replaceChildren(...draw(report));
  } catch (error) {
    $('adminText').textContent = error.isOurs ? error.message : 'The server cannot be reached. Please try again.';
  }
}
