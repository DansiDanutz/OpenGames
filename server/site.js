/* Public pages without scripts: the games, one page per game to share, and a dashboard for every creator.
   Everything in them comes from the approved games and from stats.js. */
import fs from 'node:fs';
import path from 'node:path';
import { TYPES } from '../app/library.js';

const SOURCE = 'https://github.com/DansiDanutz/OpenGames';
const CSS = fs.readFileSync(path.join(import.meta.dirname, 'site.css'));
const PAGE_POLICY = "default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const ICON_POLICY = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
const ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#1e1535"/><circle cx="11" cy="16" r="6" fill="#ff9a08"/><circle cx="21" cy="16" r="6" fill="#19d3ad"/></svg>';

export const escape = (v) => String(v).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const sum = (days) => days.reduce((n, d) => n + (d.matches ?? 0), 0);
const number = (n) => n.toLocaleString('en-US');
const matches = (n) => `${number(n)} ${n === 1 ? 'match' : 'matches'}`;
const day = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const gameUrl = (g) => `/games/${g.id}`;
const creatorUrl = (name) => `/creators/${encodeURIComponent(name)}`;
const out = (url, text, rel = '') => `<a href="${escape(url)}" rel="noopener noreferrer nofollow${rel}">${escape(text)}</a>`;
const icon = (g, size) => `<img src="${gameUrl(g)}/icon" alt="" width="${size}" height="${size}">`;

function page(title, about, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)}</title>
<meta name="description" content="${escape(about)}"><meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(about)}"><link rel="icon" href="/icon.svg" type="image/svg+xml"><link rel="stylesheet" href="/site.css"></head>
<body><header><a class="mark" href="/">Open<b>Games</b></a><nav aria-label="Main"><a href="/play">Play</a><a href="/">Games</a><a href="/creators">Creators</a>${out(SOURCE, 'Source code')}</nav></header><main>${body}</main>
<footer>Open-source games for two players. No payments, nothing of value to win.</footer></body></html>`;
}

/* One bar per day. A day before counting began has no bar; a day without a match has a line on the ground. */
function chart(g, days) {
  const W = 600, H = 120, step = W / days.length, most = Math.max(1, ...days.map((d) => d.matches ?? 0));
  const bars = days.map((d, i) => {
    if (d.matches === null) return '';
    const h = d.matches ? Math.max(4, (d.matches / most) * H) : 2, x = i * step + 1, w = step - 2, r = Math.min(4, h);
    const bar = `M${x} ${H + 10}v${-(h - r)}q0 ${-r} ${r} ${-r}h${w - 2 * r}q${r} 0 ${r} ${r}v${h - r}z`;
    return `<g><title>${day(d.day)}: ${matches(d.matches)}</title><rect x="${i * step}" y="0" width="${step}" height="${H + 10}"/><path${d.matches ? '' : ' class="none"'} d="${bar}"/></g>`;
  }).join('');
  const label = `${g.name}: matches per day in the last ${days.length} days, ${number(sum(days))} in total, at most ${number(most)} on one day.`;
  return `<figure><figcaption>Matches per day <span>most on one day: ${number(Math.max(0, ...days.map((d) => d.matches ?? 0)))}</span></figcaption><svg viewBox="0 0 ${W} ${H + 12}" role="img" aria-label="${escape(label)}"><path class="ground" d="M0 ${H + 10.5}h${W}"/>${bars}</svg>
<p class="ends"><span>${day(days[0].day)}</span><span>${day(days.at(-1).day)}</span></p>
<details><summary>Show the numbers</summary><table><thead><tr><th scope="col">Day</th><th scope="col">Matches</th></tr></thead><tbody>${days.filter((d) => d.matches !== null).reverse().map((d) => `<tr><td>${day(d.day)}</td><td>${number(d.matches)}</td></tr>`).join('')}</tbody></table></details></figure>`;
}
const tile = (label, value) => `<div><dt>${label}</dt><dd>${number(value)}</dd></div>`;
const tiles = (lists, total) => `<dl class="tiles">${tile('Today', sum(lists.flatMap((x) => x.slice(-1))))}${tile('Last 7 days', sum(lists.flatMap((x) => x.slice(-7))))}${tile('Last 30 days', sum(lists.flat()))}${tile('All time', total)}</dl>`;

const STEPS = `<ol class="steps"><li><h3>Make it</h3><p>Clone the project and tell your AI coding tool: <b>make a game</b>.</p><pre><code>git clone ${SOURCE}
cd OpenGames &amp;&amp; pnpm install</code></pre></li><li><h3>Publish it</h3><p>Say <b>publish my game</b>. It is checked and sent on GitHub. A person reads it before anybody plays it.</p></li>
<li><h3>Grow it</h3><p>Say <b>grow my game</b> to add your own support page, one sponsor line, and posts you can share.</p></li></ol>`;

const home = (games) => page('OpenGames', 'Open-source games for two players, who connect straight to each other.', `<h1>Two players. No middleman.</h1><p class="lead">Open-source games. Play a friend, find a player, or play alone against the computer.</p><p><a class="go" href="/play">Play now</a></p>
<ul class="games">${games.map((g) => `<li><a href="${gameUrl(g)}">${icon(g, 96)}<span><b>${escape(g.name)}</b><span>${escape(g.summary)}</span><small>about ${g.minutes} minutes</small></span></a></li>`).join('')}</ul>`);

const gamePage = (g) => page(`${g.name} on OpenGames`, g.summary, `<div class="title">${icon(g, 120)}<div><h1>${escape(g.name)}</h1><p>by <a href="${escape(creatorUrl(g.author))}">${escape(g.author)}</a></p></div></div><p class="lead">${escape(g.summary)}</p>
<h2>How to play</h2><ul>${g.howto.map((x) => `<li>${escape(x)}</li>`).join('')}</ul><p class="soft">Two players, about ${g.minutes} minutes. Version ${escape(g.version)}, licence ${escape(g.license)}.</p>
<p><a class="go" href="/play">Play now</a></p>${g.support ? `<h2>Support the creator</h2><p>${out(g.support, g.support.replace('https://', ''))}</p><p class="soft">This goes to the creator on their own page. OpenGames takes nothing.</p>` : ''}
${g.sponsor ? `<aside><small>Sponsor, paid to the creator</small><p><b>${escape(g.sponsor.name)}</b> ${escape(g.sponsor.text)}</p><p>${out(g.sponsor.url, new URL(g.sponsor.url).hostname, ' sponsored')}</p></aside>` : ''}`);

const creators = (games) => page('Creators on OpenGames', 'Make a game, keep everything it earns.', `<h1>Make a game. Keep what it earns.</h1><p class="lead">You need GitHub and an AI coding tool, no account with us. OpenGames takes 0% and never touches your money.</p>${STEPS}
<h2>Creator dashboards</h2><ul class="names">${[...new Set(games.map((g) => g.author))].sort().map((name) => {
    const n = games.filter((g) => g.author === name).length;
    return `<li><a href="${escape(creatorUrl(name))}">${escape(name)}</a> <span class="soft">${n} ${n === 1 ? 'game' : 'games'}</span></li>`;
  }).join('')}</ul>`);

function dashboardGame(g, stats, ranked) {
  const s = stats?.of(g.id);
  return `<section><div class="title">${icon(g, 72)}<div><h2><a href="${gameUrl(g)}">${escape(g.name)}</a></h2><p class="soft">version ${escape(g.version)}${ranked ? `, ${number(ranked(g.id))} ranked ${ranked(g.id) === 1 ? 'player' : 'players'}` : ''}</p></div></div>
${s ? `${tiles([s.days], s.total)}${chart(g, s.days)}` : ''}
<dl class="facts"><div><dt>Support page</dt><dd>${g.support ? out(g.support, g.support.replace('https://', '')) : 'Not set. Say “grow my game”.'}</dd></div><div><dt>Sponsor line</dt><dd>${g.sponsor ? `${escape(g.sponsor.name)}: ${escape(g.sponsor.text)}` : 'Free to sell. Say “grow my game”.'}</dd></div>
<div><dt>Page to share</dt><dd><a href="${gameUrl(g)}">${gameUrl(g)}</a></dd></div></dl></section>`;
}
function dashboard(name, games, { stats, ranked }) {
  const all = stats ? games.map((g) => stats.of(g.id)) : [];
  const overall = games.length > 1 ? `<h2>All games</h2>${tiles(all.map((s) => s.days), all.reduce((n, s) => n + s.total, 0))}` : '';
  return page(`${name} on OpenGames`, `Games by ${name}`, `<h1>${escape(name)}</h1>${stats ? `<p class="soft">Counted since ${day(stats.since)} ${stats.since.slice(0, 4)}, in UTC days. A match counts when two players in different places stay for a minute, so a number is an estimate. Play against the computer is never counted, and nothing about players is kept.</p>${overall}` : '<p class="soft">This server does not count matches.</p>'}
${games.map((g) => dashboardGame(g, stats, ranked)).join('')}<h2>What you earn</h2><p>Support and sponsors pay you on your own pages, so your income is only shown there. OpenGames takes 0%. Views of a sponsor line are not counted; show a sponsor the matches above.</p>`);
}

const privacy = (contact, ways) => page('Privacy on OpenGames', 'What OpenGames keeps and why.', `<h1>Privacy</h1><p class="lead">You can play without an account. This page says what is kept, and why.</p>
<h2>Without an account</h2><ul><li>Your name, your results and a key are kept on your own device.</li><li>A ranked match keeps the name you chose, a public key and the result on our server, to show the leaderboard.</li><li>We count how often each game is played, as one number per day.</li><li>Your internet address is used to connect you and to stop abuse. It is not written to our database. In a direct match the other player's device sees it; you can turn that off under “Hide my internet address”.</li></ul>
<h2>With an account</h2><ul><li>We keep your email address, the name you chose and the public keys of your devices, so your points follow you. Nothing else.</li><li>We use the address only to sign you in. No newsletters and no advertising.</li>${ways.email ? '<li>Codes are sent by Resend, which receives your address for that.</li>' : ''}${ways.google ? '<li>If you sign in with Google, Google tells us your email address and learns that you use OpenGames. We ask Google for nothing else and keep no access to your Google account.</li>' : ''}<li>It is kept until you delete the account. “Delete my account” in the app removes the address, the devices and your points at once.</li></ul>
<h2>Ask or complain</h2><p>${escape(contact)}. You can ask what we keep about you, correct it or have it removed, and you can complain to your data protection authority.</p>`);
const CONTENT = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', connection: 'close' };
const html = (status, body) => ({ status, headers: { ...CONTENT, 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': PAGE_POLICY }, body });
const part = (text) => { try { return decodeURIComponent(text); } catch { return null; } };

/* games: [{ id, name, author, files, ... }] from readLibrary. Returns the answer to a path, or null. */
export function createSite({ games, stats = null, ranked = null, contact = null, ways = { email: true, google: false } }) {
  const find = (id) => games.find((g) => g.id === id);
  const routes = [
    [/^\/$/, () => html(200, home(games))],
    [/^\/site\.css$/, () => ({ status: 200, headers: { ...CONTENT, 'content-type': 'text/css; charset=utf-8', 'cache-control': 'max-age=300' }, body: CSS })],
    [/^\/icon\.svg$/, () => ({ status: 200, headers: { ...CONTENT, 'content-type': TYPES['.svg'], 'cache-control': 'max-age=300', 'content-security-policy': ICON_POLICY }, body: ICON })],
    [/^\/games\/([a-z0-9-]{1,40})$/, (id) => { const g = find(id); return g && html(200, gamePage(g)); }],
    [/^\/games\/([a-z0-9-]{1,40})\/icon$/, (id) => {
      const g = find(id);
      return g && { status: 200, headers: { ...CONTENT, 'content-type': TYPES[path.extname(g.icon)], 'cache-control': 'max-age=300', 'content-security-policy': ICON_POLICY }, body: g.files.get(g.icon) };
    }],
    ...(contact ? [[/^\/privacy$/, () => html(200, privacy(contact, ways))]] : []),
    [/^\/creators$/, () => html(200, creators(games))],
    [/^\/creators\/([^/]{1,400})$/, (text) => {
      const name = part(text), own = games.filter((g) => g.author === name);
      return own.length > 0 && html(200, dashboard(name, own, { stats, ranked }));
    }],
  ];
  const missing = html(404, page('Not found', 'There is no such page.', '<h1>Not found</h1><p><a href="/">See the games</a></p>'));
  const site = (pathname) => {
    for (const [pattern, answer] of routes) {
      const m = pattern.exec(pathname);
      if (m) return answer(...m.slice(1)) || missing;
    }
    return null;
  };
  site.has = (pathname) => routes.some(([pattern]) => pattern.test(pathname));   // cheap, so limits come before any work
  return site;
}
