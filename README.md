# OpenGames

**No more middleman.** Open-source games for two players, who connect straight to each other.

Status: first working version, run from source. It has one game (Shikaku), no installer and no public match server yet. There are no accounts and no payments. Nothing of value can be won.

## Try it
```sh
pnpm install
pnpm demo        # a match server and two windows on one computer
```
`pnpm start` opens one window. `OPENGAMES_SERVER=wss://...` picks the match server; `pnpm server` runs one.

## How a match works
1. The match server pairs two players who have the same version of a game. It keeps no names and stores nothing.
2. The two computers try a direct connection. If that fails, or a player hides their address, the server passes the messages on.
3. Each player commits to a secret, then both reveal it. Together the secrets make the seed, so neither player can choose the board.
4. Every move is signed by its player and checked by the game's rules on both computers. The order of moves is a signed chain, so a finished match can be replayed by a referee.

## Make a game
A game is a folder with `game.json`, `rules.js` and a page. Copy `games/shikaku` to start. Games are two-player only.

`rules.js` exports `setup`, `move`, `result`, `bot` and optionally `view`. Rules must give the same answer on every computer: no time, no random numbers of their own, no imports. See `kit/engine.js`.

`node kit/check.js games/my-game` plays 20 matches with your `bot` on two engines and refuses the game if they ever disagree. Run it on your own code only.

Treat the other player's name as untrusted text: use `textContent`, never `innerHTML`.

A game page has no network, files, camera or other permissions. Its only way out is the message port in `kit/ui.js`.

## Known limits
- **Hidden cards:** both computers know the whole position, so a cheater can look at secret hands. Only games without secrets are safe so far.
- **Computer help:** a program can solve a puzzle for a player. That is one reason nothing of value can be won.
- **The host** (the player who waited) puts moves in order, so it has a small advantage when both finish at almost the same moment, and it can ignore the other player's moves. Neither computer can prove that.
- **Leaving:** a lost connection does not count for anybody, so a losing player can quit. A player who sees the start of a match and dislikes it can quit too.
- **Direct connections** work on the same network. Across the internet most matches will use the server until we run our own address service (STUN).
- **Results** are kept on your computer only. There is no ranking.
- **Names** are not unique. Do not use one to decide who somebody is.
- Only games that come with the app can be played. Installing others needs a review step first.

## Tests
`pnpm test` (engine, match, server, library), `pnpm test:app` (two real windows), `pnpm check`.

## Licenses
The app and server: AGPL-3.0. The game kit (`kit/`) and Shikaku: MIT.
