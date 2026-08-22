# Working in this repo (agents)

Conventions an automated contributor has to know before its first commit. Read
CONTRIBUTING.md for the human-facing version; this file is the short list of
things that will fail CI or waste a review round if you get them wrong.

## Sign off every commit

CI has a **Sign-off** job (`.github/workflows/ci.yml`, `dco:`) that walks every
commit in the PR and fails the whole run if any of them lacks a
`Signed-off-by:` trailer. There is no bypass and no "docs are exempt" carve-out.

```sh
git commit -s -m "fix(ui): ..."          # new commits
git rebase --signoff origin/main         # a branch you already committed
git commit --amend -s --no-edit          # the last commit only
```

OpenLeaf uses the DCO rather than a CLA (GOVERNANCE.md s.2), so this is not
ceremony: the trailer is what keeps copyright with each contributor instead of
assigning it to a steward. A commit without it is a commit the project cannot
take.

The trailer must be a real name and a real address, and it must match the commit
author. `git commit -s` derives it from `user.name` / `user.email`, so set those
before you start rather than fixing twenty commits afterwards.

## Verify before you open the PR

```sh
pnpm typecheck            # tsc -b, then the tests' own project
pnpm test                 # vitest, all packages
pnpm test:e2e             # Playwright, all three engines
pnpm test:e2e:quick       # chromium only, for a fast loop
```

`pnpm typecheck` is not optional: each package's tsconfig has
`include: ["src"]`, so a broken type in a test file is invisible to
`pnpm test` -- vitest and Playwright transpile without checking.

WebKit is not optional either. It is Safari and every iOS browser, and it is
where selection bugs live. A green chromium run is a smoke test, not a pass.

## Do not trust a green e2e run against a server you did not start

The Playwright config reuses an existing server on port 4173 outside CI. The
bundle rebuild lives in `globalSetup` so that reuse cannot serve a stale
artifact, but two concurrent `playwright test` invocations still share one
server and one bundle on disk. If several agents are working in this repo at
once, do not run the e2e suite concurrently, and if a result surprises you:

```sh
lsof -ti:4173 | xargs -r kill
node demo/build.mjs
```

A stale-bundle pass is worse than a failure, because it looks like success.

## `packages/ui/src/toolbar.ts` reads as a binary file

It contains two literal NUL bytes, in the `probe(state, ...)` cache keys. Git,
`grep`, and most editors therefore classify the file as binary: `grep` skips it
silently and `git diff` refuses to show a textual diff. If a search for a symbol
you can see in that file comes back empty, this is why -- reach for
`grep -a`, or read the file directly.

## House style

Comments explain *why*, and they are load-bearing here: several of them record a
decision and the failure that produced it. Do not delete one to make room for a
change; update it, or explain in the PR why it no longer holds. Match the
surrounding density -- this codebase is more heavily commented than most, and a
bare diff in the middle of it reads as unfinished.

No new dependencies without saying why in the PR body. No `!important`, and no
`<style>` injection fallback (see the header of `packages/ui/src/styles.ts`).
