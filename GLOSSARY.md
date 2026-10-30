# Glossary

**Game**: One title, however many ways it is owned. Editions of the same title are one Game.

**Copy**: One way a Game is owned: a Platform, a Format and, for Digital Copies, an Account. May note an Edition. A sold or traded Physical Copy is simply removed.

**Format**: Digital or Physical.

**Edition**: Optional label on a Copy (GOTY, Complete, Deluxe…). Never splits a Game.

**Platform**: The hardware a Copy runs on (PC, PS5, Switch…). An editable list. Not a Tag.

**Store**: Where Digital Copies are bought: Steam, Epic, GOG, PSN, Xbox, Nintendo or Other. A fixed list, not editable.

**Account**: One login on a Store, with a nickname, e.g. "Steam: main". Every Digital Copy names one; Physical Copies have none. The Store is fixed once created; the nickname can be renamed.

**Owned**: A Game with at least one Copy. Never set by hand.

**Unknown Copy**: A Copy whose Platform and Format aren't known yet (the Seed knows a Game is owned, not where). Counts toward Owned; shown as "location unknown" until filled in.

**Wishlist**: A Game you don't own but want. Cleared automatically when a Copy is added. Hidden from the Game list unless the filter is set to Wishlist or All.

**Play status**: Playing, Backlog, Finished, or none. Independent of ownership.

**Tag**: A descriptor of a Game. One shared, short list of broad Tags that help pick what to play alone or together: Single-player, Multiplayer, Co-op, Couch co-op, Online, Offline, Versus, Controller, then genres (Action, Adventure, RPG, Strategy, Simulation, Casual, Racing, Sports). Imports bring only these; anything else Steam lists is dropped. Tags can still be added by hand.

**Tag source**: Whether a Game's Tag came from an Import or from Asher: Import or Manual. Manual choices beat Imports.

**Manual**: The Tag source of a Tag Asher put on a Game by hand (the other value is Import). Adding by hand a Tag an Import brought makes it Manual; an Import never downgrades or removes a Manual Tag.

**Import**: Pulling a Store Account's library (and its Tags) into the catalog. Only adds; never removes manual Copies or Tags.

**Steam ID**: The 17-digit SteamID64 a Steam Account's Import reads. Private Account data: stored on the Account, never shown back, never in the repo.

**Seed**: The one-time load of the Notion "Gaming catalog" page.

**Merge**: Folding one Game into another that is really the same title. Copies and Tags combine, the other Game is deleted, and its Steam app ID still matches the kept Game in later Imports. An Unknown Copy is dropped once the other Game shows where the title is.

**Missing info**: A Game with an Unknown Copy (no location) or with no Tags. A filter finds them so they can be filled in.

**Delete (a Game)**: Removes the Game and its Copies. A Steam Game stays out of later Imports (its Steam app IDs are remembered); adding it again by hand still works.
