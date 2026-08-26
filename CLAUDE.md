# CLAUDE.md

See [AGENTS.md](AGENTS.md). The guidance for automated contributors lives there
in one copy, because two hand-maintained copies is exactly the divergence it
would be written to stop.

Two PR rules are worth repeating here:

- **Sign off every commit** (`git commit -s`). CI's Sign-off job walks every
  commit in the PR and rejects any without a `Signed-off-by:` trailer.
- **Update all affected documentation before opening or updating a PR.** Search
  beyond the nearest README for API references, package guides, security docs,
  examples, demo copy, integration guides, and machine-readable indexes that
  describe the changed behavior. Summarize those updates in the PR body, or say
  why the change has no documentation impact.

## Agent skills

### Issue tracker

GitHub Issues on `PeytonNowlin/openleaf`, driven by the `gh` CLI. See
`docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, each label string equal to its name. `wontfix` maps to
the label already in use; the other four do not exist yet and have to be created
once. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root, covering
every package. See `docs/agents/domain.md`.
