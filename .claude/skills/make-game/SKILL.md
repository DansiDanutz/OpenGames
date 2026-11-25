---
name: make-game
description: Make a new two-player game for OpenGames from an idea, or change one the creator already has. Use when somebody says "make a game", "new game" or describes a game they want.
---
# Make a game

1. Ask only what is missing: the idea in a sentence, the game's name, and the creator's GitHub name (`gh api user -q .login` when `gh` is signed in). The game must be the creator's own or a traditional one. Do not copy another game's name, art, music or levels.
2. `pnpm install` once, then `node tools/new-game.js <id> "<Name>" <github-name>`. It makes `games/<id>`, a small game that already works.
3. Read `kit/engine.js`, then write `rules.js`: `setup`, `move`, `result`, `bot`, and `view` when something is hidden. No time, no `Math.random`, no imports. `move` must refuse everything that is not allowed, also nonsense.
4. Run `node kit/check.js games/<id>`. Fix the rules until it passes. Look at the wins: far from equal means one seat has an advantage, so change the first move or the board.
5. Write `page.js`, `index.html`, `style.css` and `icon.svg`. `kit/board3d.js` draws 3D boards and `games/gemhold` shows how; plain buttons, as in the starter, are fine too. Use `textContent` for names, never `innerHTML`. It must work with a keyboard, with a screen reader and 360 px wide.
6. Fill in `game.json`: `options` a host may choose, `howto` in plain words, `minutes`.
7. Add `test/<id>.test.js` with moves that must be allowed and moves that must be refused. Run `pnpm test`.
8. `pnpm start`, press **Play alone** and play a whole game. Then `pnpm demo` for two windows.

Change only `games/<id>` and `test/<id>.test.js`. Prizes, money, gambling, adverts and network access are not allowed inside a game. When it plays well, use the `publish-game` skill.
