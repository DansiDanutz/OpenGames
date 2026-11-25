---
name: publish-game
description: Check a finished OpenGames game and send it as a pull request. Use when somebody says "publish my game", "send my game" or "update my game".
---
# Publish a game

1. `git status --short`: only `games/<id>` and `test/<id>.test.js` may have changed. Anything else goes back or into its own pull request. Never edit `library.lock.json`; a maintainer does that after reading the game.
2. When the game itself changed, raise `version` in `game.json`; players with another version cannot meet. Never raise it for `creator.json` alone, so nobody is split.
3. `node kit/check.js games/<id>`, `pnpm test`, `pnpm check`. Stop when one fails.
4. Look for secrets, names of other people and files the creator did not make. Each picture and sound needs a licence that allows this one.
5. Show the creator what will be public: the files, their GitHub name and the licence in `games/<id>/LICENSE`. **Wait for a clear yes.** It cannot be fully taken back.
6. `gh repo fork --remote` when they have no fork, then a branch `game/<id>`, `git add games/<id> test/<id>.test.js` and nothing else, a commit `feat: <Name>`, a push to the fork and `gh pr create`. Say how to play it, the check's wins, and how it was tested.
7. Read the pull request's checks and repair what they find. “Every game is approved” stays red until a maintainer has read the game; that one is not yours to repair. A person reads every game before it joins the library.
