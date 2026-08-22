# Releasing OpenLeaf

Releases are automated. `.github/workflows/release.yml` publishes a beta release
every Monday at 15:23 UTC without anybody starting it, and the same workflow is
the manual path when a release has to happen off-cadence.

Nobody should be editing a `version` field by hand. If you are reading this
because you were about to, the answer is almost certainly
[a manual dispatch](#releasing-off-cadence).

## What the weekly run does

1. **Checks whether anything landed.** The last `v*` tag to `HEAD`. Zero commits
   and the run stops there, so a quiet week does not burn a beta number on an
   identical build.
2. **Runs the full gate** — `node scripts/verify.mjs`, all three browser
   engines, not the chromium-only `--quick` form that pull requests get. Nothing
   is published if it fails, and the Playwright report is attached to the run.
3. **Bumps and rolls** — `scripts/bump.mjs` moves all fifteen packages to the
   next `0.1.0-beta.N` and turns the changelog's `## Unreleased` section into a
   dated entry for it.
4. **Commits and tags locally**, then publishes, then pushes. That order is
   deliberate: a publish that fails leaves the runner discarded and `main`
   untouched, rather than leaving a tag for a version that does not exist.
5. **Publishes** every package under the `beta` tag, then runs
   `scripts/dist-tags.mjs` so `latest` and `beta` both point at the new version.
   Until 1.0, `latest` tracks the newest prerelease; the reasoning is at the top
   of that script.
6. **Cuts a GitHub release** whose notes are the changelog section it just
   closed, verbatim.

## What you owe it

**A changelog entry, in the pull request that changes behaviour.** Add it under
`## Unreleased` in [CHANGELOG.md](../CHANGELOG.md). The release fails loudly if
commits landed and that section is empty — the gate can prove the code works, it
cannot write down what changed, and release notes reading "nothing" are worse
than skipping the week.

**A version bump: never.** The workflow owns every `version` field and the
`## Unreleased` heading. A bump in a feature branch is a merge conflict with the
next release and nothing else.

## Releasing off-cadence

Actions → Release → *Run workflow*:

- **dry_run** runs the whole gate and a `pnpm publish --dry-run`, writing
  nothing to npm or to git. This is the safe way to check the workflow itself
  after editing it.
- **version** sets an explicit version, and is **required whenever the line
  moves** — `0.2.0-beta.0`, or the first stable `0.1.0`. `bump.mjs` only infers
  `beta.N` → `beta.N+1` and errors on anything else, because choosing between
  `0.1.1` and `0.2.0` is a judgement about what changed and a cron job does not
  get to make it.

Locally, `pnpm bump --dry-run` prints the same plan the workflow would follow.

## Setup and credentials

The workflow needs one secret: **`NPM_TOKEN`**, a granular npm access token with
read and write permission on the `@openleaf-editor` scope. An *automation* token
is required rather than a publish token with 2FA, because the run has no way to
answer a one-time-password prompt — and `dist-tags.mjs` would otherwise die
part-way through its thirty registry writes when a code expired.

Two things to check once, before trusting the first unattended run:

- The token is scoped to `@openleaf-editor/*` only, and stored as a repository
  secret (or in an environment with required reviewers, if you would rather keep
  a human in the loop after all).
- `main` accepts a push from `GITHUB_TOKEN`. If branch protection rejects it,
  the publish will have already succeeded and the bump commit will be stranded
  on the runner — either allow the release bot through, or move the workflow to
  opening a release pull request instead.

Provenance attestations are not published. `pnpm publish` does not implement
npm's `--provenance` or trusted-publishing flags, so attesting would mean
packing with pnpm and publishing each tarball with `npm publish`. That is worth
doing and is not done yet.

## If a release half-happened

The failure mode worth knowing: packages published, push failed. The registry is
ahead of the repository, and the next run will measure from the old tag, try to
republish the same version and be rejected by npm.

Recover by hand, on a clean checkout of `main`:

```sh
node scripts/bump.mjs --version=<the version that got published>
git commit -s -am "release: v<version>"
git tag -a v<version> -m v<version>
git push origin main --follow-tags
node scripts/dist-tags.mjs   # idempotent; fixes any tags the run did not reach
```

`dist-tags.mjs` reads the registry before writing, so re-running it after a
partial failure moves only what is still wrong.
