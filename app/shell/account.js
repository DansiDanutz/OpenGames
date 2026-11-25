/* Signing in with an email code. Every request is signed with the key of this device, which is what keeps it signed in. */
import { sign } from './session.js';
import { identity, account, settings } from './store.js';

const TEXT = {
  bad_email: 'That does not look like an email address.',
  wrong_code: 'That code is wrong or too old. Check it, or ask for a new one.',
  too_many: 'Too many tries. Please wait a while.',
  busy: 'No more codes can be sent right now. Please try again later.',
  not_sent: 'The code could not be sent. Please try again later.',
  not_signed: 'The clock of this device seems wrong. Set it and try again.',
};
const $ = (id) => document.getElementById(id);

/* desk.account(action, body) -> { ok, body }. changed(): the name or the account is another one. */
export function createAccount({ desk, host, changed, close }) {
  let email = '', isBusy = false;
  async function ask(action, extra = {}) {
    const me = await identity(), said = { ...extra, pub: me.pub, at: Date.now() };
    const { ok, body } = await desk.account(action, { ...said, sig: await sign(me, { opengames: 'account', host, action, ...said }) });
    if (!ok) throw new Error(TEXT[body?.error] ?? 'That did not work. Please try again.');
    return body;
  }
  function keep(answer) {
    account.value = answer.signedIn ? { id: answer.id, email: answer.email } : null;
    if (answer.signedIn) settings.name = answer.name;
    changed();
    draw();
  }
  function draw(step = account.value ? 'in' : 'email') {
    for (const id of ['email', 'code', 'in']) $(`step-${id}`).hidden = id !== step;
    $('signinText').textContent = { email: 'Optional. With an account you keep the same name and points on every device.', code: `We sent six numbers to ${email}. They work for 10 minutes.`, in: `Signed in as ${account.value?.email}.` }[step];
    $('signinNote').textContent = '';
    $('accountRemove').textContent = 'Delete my account';
    $('account').textContent = account.value ? 'Account' : 'Sign in';
  }
  const run = (fn) => async (event) => {
    event?.preventDefault();
    if (isBusy) return;
    isBusy = true;
    $('signinNote').textContent = '';
    try { await fn(); } catch (error) { $('signinNote').textContent = error.message.includes('fetch') ? 'The server cannot be reached.' : error.message; } finally { isBusy = false; }
  };
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
  draw();
  return {
    draw,
    /* Another device may have changed the name or deleted the account. */
    async refresh() { if (account.value) { try { keep(await ask('me')); } catch { /* offline: stay as it was */ } } },
    async rename(name) { if (account.value) { try { await ask('name', { name }); } catch { /* sent again with the next change */ } } },
  };
}
