import test from 'node:test';
import assert from 'node:assert/strict';
import { CREATORS_ROOM, createGitHub } from '../server/github.js';

const API = 'https://api.github.com/repos/DansiDanutz/OpenGames';
const user = (login, type = 'User') => ({ login, type });
const pr = (number, extra = {}) => ({ number, title: `PR ${number}`, user: user('ann'), html_url: `https://github.com/DansiDanutz/OpenGames/pull/${number}`, created_at: '2026-11-20T10:00:00Z', merged_at: null, head: { sha: `sha${number}` }, ...extra });
const ANSWERS = {
  [API]: { stargazers_count: 12, forks_count: 3, subscribers_count: 2, watchers_count: 12 },
  [`${API}/pulls?state=open&sort=created&direction=desc&per_page=20`]: [pr(7, { title: '<b>Neon</b> game' }), pr(8, { user: user('bob') })],
  [`${API}/pulls/7/files?per_page=100`]: [{ filename: 'games/neon/rules.js' }, { filename: 'games/neon/game.json' }, { filename: 'test/neon.test.js' }],
  [`${API}/pulls/8/files?per_page=100`]: [{ filename: 'games/../x/y' }, { filename: 'games/sea/page.html' }, { filename: 'README.md' }],
  [`${API}/pulls?state=closed&sort=updated&direction=desc&per_page=30`]: [
    pr(5, { merged_at: '2026-11-21T10:00:00Z', user: user('DansiDanutz') }),
    pr(4, { merged_at: null }),
    pr(6, { merged_at: '2026-11-22T10:00:00Z', user: user('cleo') }),
    pr(3, { merged_at: '2026-11-19T10:00:00Z', user: user('dependabot[bot]', 'Bot') }),
  ],
};
function fakeFetch(answers = ANSWERS, change = () => null) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    const special = change(url);
    if (special) return special;
    if (!(url in answers)) return new Response('{"message":"Not Found"}', { status: 404 });
    return new Response(JSON.stringify(answers[url]), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { fetch, calls };
}

test('the facts of the repository, its open and merged pull requests', async () => {
  const { fetch, calls } = fakeFetch(), gh = createGitHub({ fetch });
  const { github, reason } = await gh.facts();
  assert.equal(reason, undefined);
  assert.deepEqual([github.stars, github.forks, github.watchers], [12, 3, 2]);
  assert.deepEqual(github.open.map((p) => [p.number, p.title, p.author, p.games]), [[7, '<b>Neon</b> game', 'ann', ['neon']], [8, 'PR 8', 'bob', ['sea']]]);
  assert.equal(github.open[0].url, 'https://github.com/DansiDanutz/OpenGames/pull/7');
  assert.equal(github.open[0].createdAt, '2026-11-20T10:00:00Z');
  assert.deepEqual(github.merged.map((p) => [p.number, p.author, p.invite]), [[6, 'cleo', true], [5, 'DansiDanutz', false], [3, 'dependabot[bot]', false]]);
  assert.equal(github.creatorsRoom, CREATORS_ROOM);
  assert.equal(CREATORS_ROOM, 'https://github.com/DansiDanutz/OpenGames-creators/settings/access');
  for (const { init } of calls) {
    assert.equal(init.redirect, 'error');
    assert.ok(init.signal instanceof AbortSignal);
    assert.equal(init.headers.authorization, undefined);
    assert.equal(init.method ?? 'GET', 'GET');
  }
});
test('the answer is kept for ten minutes, and the files of an unchanged pull request longer', async () => {
  let now = 0;
  const { fetch, calls } = fakeFetch(), gh = createGitHub({ fetch, clock: () => now });
  await gh.facts();
  await gh.facts();
  assert.equal(calls.length, 5);
  now += 10 * 60 * 1000 + 1;
  await gh.facts();
  assert.equal(calls.length, 8);
  assert.ok(!calls.slice(5).some((c) => c.url.includes('/files')));
});
test('two questions at once make one trip', async () => {
  const { fetch, calls } = fakeFetch(), gh = createGitHub({ fetch });
  await Promise.all([gh.facts(), gh.facts()]);
  assert.equal(calls.length, 5);
});
test('a failing GitHub gives no facts and a short reason, and is asked again later', async () => {
  let now = 0;
  const { fetch, calls } = fakeFetch({}), gh = createGitHub({ fetch, clock: () => now });
  assert.deepEqual(await gh.facts(), { github: null, reason: 'GitHub answered 404' });
  await gh.facts();
  assert.equal(calls.length, 1);
  now += 61 * 1000;
  await gh.facts();
  assert.equal(calls.length, 2);
});
test('no network, a slow answer, bad JSON and a huge answer all fail softly', async () => {
  const cases = [
    [async () => { throw new TypeError('fetch failed'); }, 'GitHub cannot be reached'],
    [async () => { throw Object.assign(new Error('late'), { name: 'TimeoutError' }); }, 'GitHub did not answer in time'],
    [async () => new Response('not json'), 'GitHub sent something unexpected'],
    [async () => new Response('[]'), 'GitHub sent something unexpected'],
    [async () => new Response('x'.repeat(3 * 1024 * 1024)), 'GitHub sent too much'],
    [async () => new Response('{}', { headers: { 'content-length': String(9 * 1024 * 1024) } }), 'GitHub sent too much'],
  ];
  for (const [fetch, reason] of cases) assert.deepEqual(await createGitHub({ fetch }).facts(), { github: null, reason });
});
test('the files of one pull request may fail without spoiling the rest', async () => {
  const { fetch } = fakeFetch(ANSWERS, (url) => (url.endsWith('/pulls/8/files?per_page=100') ? new Response('', { status: 500 }) : null));
  const { github } = await createGitHub({ fetch }).facts();
  assert.deepEqual(github.open.map((p) => p.games), [['neon'], null]);
});
test('strange data from GitHub is cleaned or left out', async () => {
  const answers = { ...ANSWERS,
    [`${API}/pulls?state=open&sort=created&direction=desc&per_page=20`]: [pr(9, { html_url: 'javascript:alert(1)', title: 'x'.repeat(500), user: user('<script>') }), { number: 'x' }, null],
    [`${API}/pulls/9/files?per_page=100`]: [],
  };
  const { github } = await createGitHub({ fetch: fakeFetch(answers).fetch }).facts();
  assert.equal(github.open.length, 1);
  assert.deepEqual([github.open[0].url, github.open[0].author, github.open[0].title.length], [null, null, 200]);
});
test('at most 20 open and 10 merged pull requests', async () => {
  const many = Array.from({ length: 30 }, (_, i) => pr(100 + i, { merged_at: `2026-11-${String(1 + (i % 28)).padStart(2, '0')}T00:00:00Z` }));
  const answers = { ...ANSWERS, [`${API}/pulls?state=open&sort=created&direction=desc&per_page=20`]: many, [`${API}/pulls?state=closed&sort=updated&direction=desc&per_page=30`]: many };
  const { fetch } = fakeFetch(answers, (url) => (url.includes('/files') ? new Response('[]') : null));
  const { github } = await createGitHub({ fetch }).facts();
  assert.equal(github.open.length, 20);
  assert.equal(github.merged.length, 10);
  assert.ok(github.merged.every((p, i) => i === 0 || p.mergedAt <= github.merged[i - 1].mergedAt));
});
