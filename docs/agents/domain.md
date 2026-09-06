# Domain Docs

How the engineering skills should consume this repo's domain documentation when
exploring the codebase.

This repo is **single-context**: one glossary and one ADR directory at the root,
covering every package. The `packages/*` split is a delivery boundary, not a
domain boundary — `schema`, `preservation layer`, `sanitize policy` and
`round-trip fidelity` mean the same thing in `core` as they do in `sanitize` or
`plugins-table`, and sixteen glossaries would be sixteen copies of the same
terms.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root
- **`docs/adr/`**: read ADRs that touch the area you're about to work in

If any of these files don't exist, **proceed silently**. Don't flag their
absence; don't suggest creating them upfront. The `/domain-modeling` skill
(reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates
them lazily when terms or decisions actually get resolved.

Note that `AGENTS.md` is not one of these files. It carries the repo's
contribution rules (sign-off, verification, documentation obligations), not its
domain vocabulary, and the two should not be merged.

## File structure

```
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-....md
│   └── 0002-....md
└── packages/
```

If this repo ever does split into genuinely separate domains, the multi-context
layout is a root `CONTEXT-MAP.md` pointing at one `CONTEXT.md` per context, with
context-scoped `docs/adr/` directories beneath each. Adding `CONTEXT-MAP.md` is
what switches the skills over.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal,
a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift
to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either
you're inventing language the project doesn't use (reconsider) or there's a real
gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than
silently overriding:

> _Contradicts ADR-0007 (...), but worth reopening because…_
