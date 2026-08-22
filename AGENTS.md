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

## Update documentation before you open the PR

Documentation is part of the change, not a follow-up. Before opening or updating
a PR, search for every document that describes the behavior you changed and
update all affected copies in the same branch. Check the project README, package
READMEs, API and security references, integration guides, examples, demo copy,
and machine-readable indexes such as `demo/llms.txt` as applicable; updating only
the nearest README is not enough when the same contract is documented elsewhere.

Run `node scripts/check-docs.mjs` for the integration entry points it covers
(and the measured size claims in `docs/authoring-plugins.md` §4.5 and
`demo/index.html`), then review the diff yourself for documentation that cannot
be checked mechanically. In the PR body, summarize the documentation updates, or state why
the change has no user-facing or contributor-facing documentation impact.

## Never bump a version; do write the changelog entry

Every `@openleaf-editor/*` package shares one version, and the weekly release
workflow owns it -- `.github/workflows/release.yml` bumps all fifteen manifests
and rolls `## Unreleased` into a dated section every Monday. A version edited in
a feature branch is a merge conflict with the next release and nothing else.

What a behaviour change does owe: an entry under `## Unreleased` in
`CHANGELOG.md`, in the same pull request. The release refuses to publish a week
where commits landed and that section is empty, so skipping it does not save
work, it moves the work to whoever is looking at a red release run on Monday.

Details in `docs/releasing.md`.

## Do not trust a green e2e run against a server you did not start

The Playwright config reuses an existing server outside CI. Two things keep that
sound, and you should know both before you debug a surprising e2e result.

The bundle rebuild lives in `globalSetup` rather than `webServer.command`, so
reuse cannot serve a stale artifact -- `command` runs only when Playwright
*starts* a server. And the harness port is derived from the checkout path
(`packages/element/test/e2e/port.ts`), so each worktree gets its own and reuse
can only ever find a server started from the tree you are running in. Yours is
in the `harness server on http://localhost:...` line the server logs at the top
of a run, and in the abort message below. Pin it if you want a fixed address:

```sh
PORT=4173 pnpm test:e2e
```

Concurrent runs in *different* worktrees are therefore fine now. Two concurrent
`playwright test` invocations in the *same* worktree still share one server and
one bundle on disk, so do not do that. If `global-setup.ts` aborts with "is not
serving this checkout", something really is on your port that did not come from
here -- a server started before the port became per-checkout, a hand-set `PORT`,
or two paths that hashed alike:

```sh
lsof -ti:<your port> | xargs -r kill
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
