# QA against the live site

Playwright checks that run against https://games.ashershores.com as me. Not a workspace, so CI
never installs or runs it.

```sh
cd e2e && npm install       # once; Chromium comes from the shared Playwright cache
npm run login               # asks for the password (no echo); saves the session
npm run qa                  # read-only checks
npm run qa:write            # plus add/edit/merge/delete of QA-… Games, Platforms, Accounts, Tags
```

The session (Cognito tokens, not the password) is saved to `~/.config/games-qa/state.json`
with 600 permissions, outside the repo. It lasts as long as the refresh token (30 days of not
opening it); each run saves the rotated token. `npm run logout` revokes it with Cognito and
deletes the file; do that when you're done testing for a while.

The write run names everything `QA-<run id>-…` and finishes with a sweep that deletes any
`QA-…` Game, Platform, Account or Tag, including leftovers from a run that crashed. It never
edits or deletes anything else (it reuses the existing Co-op Tag and PC Platform for its Game).

Screenshots (and one per failed check) go to `e2e/out/`, which is gitignored.
