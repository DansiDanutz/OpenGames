# OpenGames

**No more middleman.** Open-source games for two players, who connect straight to each other. Or play alone against the computer, also without internet.

Three games in 3D, with sound: Shikaku, Gemhold, and Avioane & Bărcuțe. An account is optional and there are no payments. Nothing of value can be won; a place on a leaderboard is all there is.

## Play in a browser or on a phone
The match server also serves the app at `/play`: the same games, against the same players. It can be installed on a phone or computer (**Install the app**; on an iPhone, Share and *Add to Home Screen*). Nobody has to sign in: the player's name and key stay in that browser, so they are the same player next time. Another browser or a cleared one is a new player, unless they sign in. An invite holds a link that opens the match, and it waits ten minutes even when the phone shows WhatsApp.

A game runs in a sandboxed frame with an origin of its own and no network. The tests try to get out of it in Chrome and WebKit: other addresses, the window around it, frames of its own, WebRTC. One thing the rules of browsers leave open is a hint to look up or connect to an address (`dns-prefetch`, `preconnect`); reading every game before it is approved covers that. Firefox is not tested. An invite link only asks; nobody is connected before **Join**.

## Try it
```sh
pnpm install
pnpm demo        # a match server and two windows on one computer
```
`pnpm start` opens one window. `OPENGAMES_SERVER=wss://...` picks the match server; `pnpm server` runs one.

## A match
The player who starts a match chooses the rules: the board, easy or hard, heads-up, best of three or best of five, and whether it is ranked. The other player reads those rules and how to win, and accepts them or leaves. Only then do the computers make the board.

| Game | Boards | Easy | Hard |
|---|---|---|---|
| Shikaku | 5, 6, 8, 10 | small blocks, wrong ones are marked | bigger blocks, nothing is marked |
| Gemhold | 5, 6, 7, 10 | open field | rocks on the field |
| Avioane & Bărcuțe | 8, 10, 12 | a miss beside a piece is "near" | a miss is only a miss |

1. The match server pairs two players who have the same version of a game. An invite can be copied, or opened in WhatsApp with one click; the player sends it.
2. The two computers try a direct connection. If that fails, or a player hides their address, the server passes the messages on.
3. Each player commits to a secret, then both reveal it. Together the secrets make the seed, so neither player can choose the board.
4. Every move is signed by its player and checked by the game's rules on both computers. The rules the players agreed on are part of what they sign. The moves form a signed chain, so a referee can replay the match.
5. In a best of three or five the players change seats after every game.

**Leaderboards.** Each game has one. After a ranked match the signed moves go to the match server, which replays the whole match before it moves any points (Elo, from 1200). It accepts only the two players it introduced. Two players can rank against each other five times a day, and not from the same internet address. Players who leave more than one match in five are not shown.

## Earning
A creator may add `creator.json` to their game: a page where players can support them and one sponsor line (`.claude/skills/grow-game`). OpenGames takes nothing and never handles money. A line is text with an https page, marked “Sponsor”, on the game's card only, never inside a match. The app asks before it opens the browser, and counts nothing. Not allowed: gambling, crypto, adult content, alcohol, tobacco, loans, politics. The maintainers may refuse or remove a line.

## Alone
**Play alone** uses the same boards and rules against the game's own bot. Nothing is sent anywhere, and it is never ranked. The easy bots are careless on purpose. In Shikaku the bot is slowed to about the pace of a person.

## Make a game
Clone this repository and ask your assistant to **make a game**, then to **publish my game**: the skills in `.claude/skills` do the rest (`AGENTS.md` for other assistants). By hand: `node tools/new-game.js my-game "My Game" my-github-name`.

A game is a folder with `game.json`, `rules.js`, an icon and a page. Games are for two players, or one against the bot.

- `rules.js` exports `setup`, `move`, `result`, `bot` and optionally `view` and `pace`. `bot` is also the opponent of a person who plays alone; it gets only what a player in its seat may see. Rules must give the same answer on every computer: no time, no random numbers of their own, no imports. See `kit/engine.js`.
- `game.json` lists `options` (what a host may choose) and `howto` (the rules the other player reads).
- `kit/board3d.js` draws a 3D board with light, effects and the pointer; `kit/sound.js` makes sound effects; `kit/table.css` is the common look. Keep the keyboard and the text for screen readers working.
- Treat the other player's name as untrusted text: use `textContent`, never `innerHTML`.
- A game page has no network, files, camera or other permissions. Its only way out is the message port in `kit/ui.js`.

`node kit/check.js games/my-game` plays every combination of options with your `bot` on two engines and refuses the game if they ever disagree. The rules run in a program of their own that cannot write, start programs or read other files. It is a first filter, not a judge: a person reads every game, and `node tools/approve.js my-game` then records its exact files in `library.lock.json`. An installed app plays only those.

`kit/three.js` is three.js (MIT), built by `pnpm kit`.

## Run a match server
```sh
DATA_DIR=/var/lib/opengames STUN_PORT=3478 HOST=0.0.0.0 PORT=4310 TRUST_PROXY=1 node server/main.js
```
Or use `deploy/`: `PLAY_DOMAIN=play.example.org docker compose -f deploy/compose.yml up -d --build` runs the server behind Caddy, which gets the certificate. Open ports 80, 443 and 3478/udp. If Traefik already owns those ports, use `deploy/install-traefik.sh` instead.

Node 26 or newer. Put a proxy with TLS in front of it, so players use `wss://`. `TRUST_PROXY` is the number of proxies in front; leave it at 0 without one, or anybody can pretend to be another address. `STUN_PORT` (UDP, not behind the proxy) lets players find a direct connection over the internet. Without `DATA_DIR` there are no leaderboards and no counts. Back up `leaderboard.db` and `stats.db`. `GET /health` answers when the server is up. On one computer, 3000 players sent 5,850 messages a second through the server with none lost (99% under 30 ms, 95 MB of memory).

The server also has public pages without scripts: `/` (the games), `/games/<id>` (a page to share), `/creators` (how to start) and `/creators/<author>` (a dashboard with matches per day). For play it keeps one number per game and day, nothing about players. A match counts when two players at different addresses stay for a minute, at most 20 a day per address and game; play against the computer is never counted.

## Sign-in
Optional. A player types an email address and the six-digit code sent to it; the device then stays signed in, and all devices of an account share a name and points. There are no passwords or cookies: every request is signed with the device's own key. The server keeps the address, the name and the public keys of the devices, until the player deletes the account. It is off unless `RESEND_API_KEY`, `MAIL_FROM`, `PRIVACY_CONTACT` and `PLAY_DOMAIN` are set; then `/privacy` is shown too, which the operator has to read and answer for. Back up `accounts.db` and keep it private. A server sends at most 90 codes a day, so many requests can use them up. With `deploy/compose.traefik.yml`, put the three in a file only you can read and set `MAIL_ENV` to its path.

## Build the app
```sh
pnpm pack-app --server wss://play.example.org --stun stun:play.example.org:3478
```
The server is built in. The packed app checks its own files, cannot be run as plain Node or debugged, and plays approved games only. Without a signing identity (`CSC_NAME`) it is signed for this computer only. To publish on a Mac, set `CSC_NAME` (a Developer ID) and `APPLE_KEYCHAIN_PROFILE` (a notarytool profile). Windows needs a certificate of its own.

## Known limits
- **Hidden cards:** both computers know the whole position, so a cheater can look at secret hands. A game can avoid this as Avioane & Bărcuțe does: each fleet stays on its own computer under a seal and is checked at the end. A player who will not answer or show the fleet can only end the match without a result.
- **Computer help:** a program can solve a puzzle for a player. That is one reason nothing of value can be won.
- **The host** puts moves in order, so it has a small advantage when both finish at almost the same moment, and it can ignore the other player's moves. Neither computer can prove that.
- **Choosing a board by leaving:** the host learns the board a moment before the guest does. A changed host could leave before the first move until it likes the board; that is not counted against it. The server only limits how many players one address meets in a minute.
- **Matchmaking:** somebody with many addresses can still get in the way of random matches. Invite codes are not affected.
- **Leaving:** a lost connection costs nobody points. It is counted for both players of a ranked match, because the server cannot know who left.
- **Several computers:** somebody with two internet connections can play against themselves. The daily limit and the rating keep that slow, not impossible.
- **Gemhold 5 × 5 and 6 × 6, hard:** the player who goes second wins about 60% of bot matches. Seats change in a best of three or five.
- **Names** are not unique. Do not use one to decide who somebody is.
- **Very slow graphics:** games lower their own detail, but they need WebGL 2.

## Tests
`pnpm test` (engine, series, session, server, site, leaderboard, network, check), `pnpm test:app` (real windows, and a phone's screen in Chrome; `node test/web.e2e.js webkit` for an iPhone's), `node test/packed.e2e.js <program>` (the packed app), `pnpm check`.

## Licenses
The app and server: AGPL-3.0. The game kit (`kit/`) and the three games: MIT. three.js: MIT.
