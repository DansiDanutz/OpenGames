/* Signing in with Google: the page leaves for Google and comes back with a code, which this server exchanges itself.
   No script of Google runs in the app. The client secret comes from the environment and is never logged. */
import { createHash, randomBytes } from 'node:crypto';

const ASK = 'https://accounts.google.com/o/oauth2/v2/auth', EXCHANGE = 'https://oauth2.googleapis.com/token';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'], GOOGLE_MS = 10_000, SKEW_S = 60, MAX_ANSWER = 16 * 1024;
const random = () => randomBytes(32).toString('base64url');

export function createGoogle({ id, secret, host, fetcher = fetch, clock = Date.now }) {
  const back = () => `https://${host()}/account/google`;
  return {
    /* Where to send the player, and what this server must remember until they come back. */
    begin() {
      const state = random(), verifier = random(), nonce = random();
      const query = new URLSearchParams({ client_id: id, redirect_uri: back(), response_type: 'code', scope: 'openid email', state, nonce, prompt: 'select_account',
        code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
      return { state, verifier, nonce, url: `${ASK}?${query}` };
    },
    /* The address, straight from Google. Only an address Google itself is in charge of. */
    async finish({ code, verifier, nonce }) {
      const res = await fetcher(EXCHANGE, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(GOOGLE_MS), headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code, client_id: id, client_secret: secret, redirect_uri: back(), grant_type: 'authorization_code', code_verifier: verifier }).toString() });
      if (!res.ok) throw new Error(`Google answered ${res.status}`);
      const text = await res.text();
      if (text.length > MAX_ANSWER) throw new Error('Google answered too much');
      const claims = JSON.parse(Buffer.from(JSON.parse(text).id_token.split('.')[1], 'base64url').toString('utf8'));
      if (!ISSUERS.includes(claims.iss) || claims.aud !== id || claims.nonce !== nonce || !(claims.exp > clock() / 1000 - SKEW_S)) throw new Error('not an answer to this request');
      if (claims.email_verified !== true || typeof claims.email !== 'string') return null;
      return /@gmail\.com$/i.test(claims.email) || (typeof claims.hd === 'string' && claims.email.toLowerCase().endsWith(`@${claims.hd.toLowerCase()}`)) ? claims.email : null;
    },
  };
}
