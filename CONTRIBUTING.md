# Contributing to OpenLeaf

## The one thing to read first

OpenLeaf's core promise is that it will not eat your content. Before
adding or changing anything that touches HTML parsing or serialization,
read `packages/core/test/fidelity.test.ts` and add a fixture that
demonstrates your case. A feature that improves the editing experience
while lowering the fidelity pass rate is a net negative and will be
rejected.

## Developer Certificate of Origin

OpenLeaf uses the DCO rather than a CLA. You keep the copyright in your
contribution; we deliberately have no mechanism to take it. See
[GOVERNANCE.md](GOVERNANCE.md) section 2 for why this matters.

Sign off every commit:

```bash
git commit -s -m "fix(core): preserve data-* attributes on unwrapped divs"
```

That appends a line certifying the [DCO](https://developercertificate.org/):

```
Signed-off-by: Your Name <your.email@example.com>
```

Use your real name and a working email address. CI enforces this: the `dco`
job checks every commit on the pull request and fails the build if any of them
is missing a sign-off. If you forget, `git rebase --signoff origin/main` fixes
the whole branch.

## Getting set up

```bash
pnpm install
pnpm exec playwright install   # first time only
pnpm verify                    # the whole gate
```

`pnpm verify` is the one command to remember. It builds every package,
type checks `src` *and* the tests, runs the unit and round-trip fidelity suites,
runs the browser suite in all three engines, imports every published entry point
with no DOM present, and checks the architecture guards and bundle budgets.

It runs exactly what CI runs, and not by coincidence: CI shells out to the same
script (`node scripts/verify.mjs`), so there is no second list of steps to drift
out of sync. The single difference is the engine set -- a pull request runs
`--quick`, which is Chromium only, and the full three-engine run happens nightly
and on demand.

Narrower loops:

```bash
pnpm verify:quick    # same gate, chromium only
pnpm test            # unit + round-trip fidelity only (~1s)
pnpm test:e2e:quick  # browsers, chromium only
pnpm test:e2e:ui     # Playwright's interactive runner
```

`pnpm test` is fast and you should run it constantly. The browser tests are
where editor bugs actually live -- jsdom does not model selection, composition
events, or clipboard behaviour faithfully enough to trust. Run the full
`pnpm verify` before pushing.

**What CI runs on your pull request:** `node scripts/verify.mjs --quick` (the
whole gate, Chromium only, a few minutes) and the DCO sign-off check. Firefox
and WebKit run nightly on `main` and on demand from the Actions tab, so they are
not between you and a merge -- which is exactly why you should run the full
`pnpm verify` locally first. A WebKit regression found tomorrow morning is
harder to place than one found before you push.

**When the nightly does go red**, it files an issue titled `Nightly CI is red`
and closes it again on the next green run, so an open one always means the last
nightly failed. Further failures comment on that issue rather than opening a
second. Nothing blocks on a scheduled run, so without the issue a red nightly is
only as visible as one person's inbox -- which is how a Firefox failure once sat
on `main` for six nights. The weekly release does the same under `The Monday
release is red`. See `.github/alarm.sh`.

## Commit format

Conventional Commits, scoped by package:

```
feat(plugins-table): support merging cells across a row boundary
fix(paste): strip mso-list markers without collapsing nesting
docs(governance): clarify trademark use in plugin names
```

## Releases

You do not cut one. A beta ships every Monday from
[`.github/workflows/release.yml`](.github/workflows/release.yml), unattended,
and it owns every `version` field in the repo.

What that asks of a pull request is one thing: **if it changes behaviour, add an
entry under `## Unreleased` in [CHANGELOG.md](CHANGELOG.md)**. The release fails
outright if commits landed with that section empty, because notes nobody wrote
are worse than a skipped week.

Never bump a `version` in a branch. See [docs/releasing.md](docs/releasing.md)
for the full pipeline, the off-cadence dispatch, and how to recover a release
that half-happened.

## What we will and will not take

**Wanted:** paste-fidelity fixtures from real documents (redact anything
private), accessibility bug reports with the assistive tech and version
named, browser-specific selection bugs with reproduction steps, i18n
translations, CMS integration modules.

**Held back for now:** math rendering, comments and track changes,
PDF/DOCX export, spell and grammar checking, mentions, AI features. These
are not rejected forever, they are out of scope until the v0.1 core is
boringly reliable. See the roadmap.

**Declined:** anything that introduces a framework dependency into
`core`, `element`, or `ui`. Anything that adds a network call not
explicitly configured by the integrator. Anything gated behind a tier.

## Accessibility bar

New UI must be keyboard reachable, must have an accessible name, and must
be tested against at least one screen reader before review. State which
one and which version in the pull request. We do not accept axe-core
passing as evidence of accessibility -- automated tooling catches roughly
a third of real barriers, and we would rather say so than claim a
compliance level we have not verified.
