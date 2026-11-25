---
name: grow-game
description: Set where players can support a creator, add one sponsor line to their OpenGames game, and write launch posts. Use when somebody says "earn", "support page", "sponsor", "advertise" or "promote my game".
---
# Grow a game

OpenGames takes nothing and never handles money. Payments happen on the creator's own pages, under the creator's own name and taxes. Do not promise an income.

1. Support: ask for the creator's own page at GitHub Sponsors, Ko-fi, Buy Me a Coffee, Patreon, Liberapay or Open Collective. They open it themselves; never make an account or fill in payment details for them.
2. Sponsor, only when the creator has an agreement with one: the sponsor's name, one line of text and an https page. Refuse gambling, betting, crypto, adult content, alcohol, tobacco, loans, politics and anything that asks children for money.
3. Write `games/<id>/creator.json`. Leave out what they do not have:
   ```json
   { "support": "https://ko-fi.com/name", "sponsor": { "name": "Shop", "text": "One line", "url": "https://example.com/" } }
   ```
   `node kit/check.js games/<id>` must pass. The version players meet with stays the same, so nobody is split.
4. Send it with `publish-game`. A person reads it before players see it. To end a sponsorship, remove it and send that.
5. Launch posts: write short ones for the places the creator names, with what is fun about the game and how to play it. Nothing invented: no player numbers, quotes or reviews they do not have. The creator reads and sends them; never post for them. A post that a sponsor paid for says so.
