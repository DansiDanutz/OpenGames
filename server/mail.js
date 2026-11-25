/* Sends a sign-in code through Resend. The key comes from the environment and is never logged. */
const MAIL_MS = 10_000;

export function createMail({ key, from, fetcher = fetch }) {
  return async ({ to, code }) => {
    const res = await fetcher('https://api.resend.com/emails', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(MAIL_MS),
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject: `${code} is your OpenGames code`,
        text: `Your OpenGames sign-in code is ${code}.\n\nIt works for 10 minutes, only on the device that asked for it. Do not give it to anybody.\nIf you did not ask for it, ignore this message; nobody can sign in without the code.` }) });
    if (!res.ok) throw new Error(`the mail service answered ${res.status}`);
  };
}
