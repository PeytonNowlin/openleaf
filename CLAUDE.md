# CLAUDE.md

See [AGENTS.md](AGENTS.md). The guidance for automated contributors lives there
in one copy, because two hand-maintained copies is exactly the divergence it
would be written to stop.

The one rule worth repeating here, because it fails CI on every branch that
misses it: **sign off every commit** (`git commit -s`). CI's Sign-off job walks
every commit in the PR and rejects any without a `Signed-off-by:` trailer.
