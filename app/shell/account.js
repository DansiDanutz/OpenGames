/* Signing in with Google or with an email code. Every request is signed with the key of this device, which is what keeps it signed in. */
import { sign } from './session.js';
import { identity, account, settings } from './store.js';

const TEXT = {
  bad_email: 'That does not look like an email address.',
  wrong_code: 'That code is wrong or too old. Check it, or ask for a new one.',
  too_many: 'Too many tries. Please wait a while.',
  busy: 'No more codes can be sent right now. Please try again later.',
  not_sent: 'The code could not be sent. Please try again later.',
  wrong_device: 'Google answered, but to another window. Please sign in again in the browser where you play.',
  not_signed: 'The clock of this device seems wrong. Set it and try again.',
  not_admin: 'This account is not an admin.',
};
const ours = (text) => Object.assign(new Error(text), { isOurs: true });
const $ = (id) => document.getElementById(id);

/* desk.account(action, body) -> { ok, body }. changed(): the name or the account is another one.
   openAdmin(load): shows the admin view; load() asks the server for it, signed. Only where desk.canAdmin. */
export function createAccount({ desk, host, ways, changed, close, beforeGoogle = () => {}, openAdmin = () => {} }) {
  let email = '', isBusy = false;
  async function ask(action, extra = {}) {
    const me = await identity(), said = { ...extra, pub: me.pub, at: Date.now() };
    const { ok, body } = await desk.account(action, { ...said, sig: await sign(me, { opengames: 'account', host, action, ...said }) });
    if (body?.error === 'not_signed_in') { keep({ signedIn: false }); throw ours('This device is not signed in any more.'); }
    if (!ok) throw ours(TEXT[body?.error] ?? 'That did not work. Please try again.');
    return body;
  }
  function keep(answer) {
    account.value = answer.signedIn ? { id: answer.id, email: answer.email, admin: answer.admin === true } : null;
    if (answer.signedIn) settings.name = answer.name;
    changed();
    draw();
  }
  function draw(step = account.value ? 'in' : 'email') {
    for (const id of ['email', 'code', 'in']) $(`step-${id}`).hidden = id !== step || (id === 'email' && !ways.email);
    $('step-google').hidden = step !== 'email' || !ways.google;
    $('signinText').textContent = { email: 'Optional. With an account you keep the same name and points on every device.', code: `We sent six numbers to ${email}. They work for 10 minutes.`, in: `Signed in as ${account.value?.email}.` }[step];
    $('signinNote').textContent = '';
    $('accountRemove').textContent = 'Delete my account';
    $('account').textContent = account.value ? 'Account' : 'Sign in';
    $('adminOpen').hidden = !(step === 'in' && account.value?.admin === true && desk.canAdmin === true);
  }
  const run = (fn) => async (event) => {
    event?.preventDefault();
    if (isBusy) return;
    isBusy = true;
    $('signinNote').textContent = '';
    try { await fn(); } catch (error) { $('signinNote').textContent = error.isOurs ? error.message : 'The server cannot be reached. Please try again.'; } finally { isBusy = false; }
  };
  $('googleGo').onclick = run(async () => {
    const { url } = await ask('google');
    beforeGoogle();
    desk.toGoogle(url);
  });
  $('step-email').onsubmit = run(async () => {
    email = $('emailInput').value.trim().toLowerCase();
    await ask('start', { email });
    draw('code');
    $('codeInput').value = '';
    $('codeInput').focus();
  });
  $('step-code').onsubmit = run(async () => {
    keep(await ask('finish', { email, code: $('codeInput').value.replace(/\D/g, ''), name: settings.name }));
    $('signinNote').textContent = 'This device stays signed in.';
  });
  $('codeAgain').onclick = () => draw('email');
  $('accountLeave').onclick = run(async () => keep(await ask('leave')));
  $('accountRemove').onclick = run(async () => {
    if ($('accountRemove').textContent === 'Delete my account') { $('accountRemove').textContent = 'Delete it and my points for good'; return; }
    keep(await ask('remove'));
    $('signinNote').textContent = 'Your account is deleted.';
  });
  $('signinBack').onclick = close;
  $('adminOpen').onclick = () => openAdmin(() => ask('admin'));
  draw();
  return {
    draw,
    /* Back from Google, with a ticket only this device can use. */
    fromGoogle: (ticket) => run(async () => {
      if (ticket === 'failed') throw ours('Google did not sign you in. Please try again, with a Gmail or Google Workspace address.');
      keep(await ask('enter', { ticket, name: settings.name }));
      $('signinNote').textContent = 'This device stays signed in.';
    })(),
    /* Another device may have changed the name or deleted the account. */
    async refresh() { if (account.value) { try { keep(await ask('me')); } catch { /* offline: stay as it was */ } } },
    async rename(name) { if (account.value) { try { await ask('name', { name }); } catch { /* sent again with the next change */ } } },
  };
}
