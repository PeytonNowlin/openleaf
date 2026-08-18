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

Use your real name and a working email address. CI enforces this.

## Getting set up

```bash
pnpm install
pnpm exec playwright install   # first time only
pnpm verify                    # the whole gate: typecheck, unit, browsers, size
```

`pnpm verify` is the one command to remember. It takes about thirteen seconds
and runs exactly what CI runs, so "passes locally" and "passes CI" mean the
same thing.

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

**CI is manual-only** at the moment (`workflow_dispatch`), so the local gate is
the real gate. Do not push on the assumption that a remote runner will catch
it. See the note in the README.

## Commit format

Conventional Commits, scoped by package:

```
feat(plugins-table): support merging cells across a row boundary
fix(paste): strip mso-list markers without collapsing nesting
docs(governance): clarify trademark use in plugin names
```

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
