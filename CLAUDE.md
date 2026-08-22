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
