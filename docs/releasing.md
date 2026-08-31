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
7. **Raises the alarm if any of that failed** — an issue titled `The Monday
   release is red`, which the next green scheduled run closes by itself. A
   scheduled run blocks nothing and requests nobody, so a failed release is
   otherwise as visible as one person's inbox; the release of 2026-08-24 failed
   and went unread until the following Monday's joined it. Only the cron raises
   it: a run you dispatched yourself is one you are already watching. See
   `.github/alarm.sh`.

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

The publish authenticates with **trusted publishing (OIDC)**. There is no
long-lived npm token in the publish path: the workflow presents its GitHub OIDC
token, npm exchanges it for a credential scoped to this repository and this
workflow file, and attaches a provenance attestation automatically -- no
`--provenance` flag, because pnpm does not implement one.

That is not just the nicer option, it is the only one with a future. npm is
closing the alternative in two steps:

| Date | What changes |
| --- | --- |
| 2026-07-31 | A 2FA-bypass granular token can no longer create or delete tokens, change package access or maintainers, or touch trusted-publishing configuration. |
| ~January 2027 | A 2FA-bypass token loses **direct publish**. Its publishing surface drops to reading private packages and *staging* a publish that a human approves with 2FA. |

An unattended Monday release cannot answer a 2FA challenge, so after that second
date a token-based version of this workflow simply stops being a release
pipeline. See [the npm changelog entry](https://github.blog/changelog/2026-07-08-npm-install-time-security-and-gat-bypass2fa-deprecation/).

### One-time setup, per package

Trusted publishing is configured **per package**, and there are fifteen of them.
Do it from the CLI rather than the website:

```sh
npm login                                  # once; needs npm >= 11.15.0
node scripts/trust-publishers.mjs --dry-run  # what it would configure
node scripts/trust-publishers.mjs          # configure it
```

The script reads which packages already trust this workflow before writing
anything, so it is safe to re-run and it only ever spends the 2FA window on
packages that need it. The first write triggers a two-factor challenge, and npm's
web prompt offers to **skip 2FA for the next five minutes** — take it, and the
remaining fourteen go through unattended. There is a two-second pause between
writes because the registry rate-limits the endpoint.

The equivalent by hand, per package, is npmjs.com → the package → *Settings* →
*Trusted publishing* → *Select your publisher* → **GitHub Actions**:

| Field | Value |
| --- | --- |
| Organization or user | `PeytonNowlin` |
| Repository | `openleaf` |
| Workflow filename | `release.yml` — the **filename only**. `.github/workflows/release.yml` is the usual way to get this wrong, and it fails later as a 404 on the publish that reads like a broken token. |
| Environment name | leave empty |
| Allowed actions | `npm publish` only |

`npm stage publish` is deliberately **not** granted. Staged publishing exists to
defer a publish for a human to approve with 2FA, which is the opposite of what
this pipeline is for; granting only what the weekly run uses means a stolen OIDC
claim cannot stage anything either.

Three constraints worth knowing before you debug a failure: it does not work on
self-hosted runners, the repository must be the one running the workflow, and a
`workflow_call` indirection breaks validation because npm checks the *calling*
workflow's name. This workflow avoids all three.

Verify at any point with `npm trust list @openleaf-editor/core`, and undo with
`npm trust revoke <package> --id=<id>`.

### A brand-new package needs one manual publish first

Trusted publishing is per-package configuration, and npm has nowhere to record
it for a package the registry has never seen. The POST returns 404 — the *same*
404 it returns for a broken trust relationship, which is a genuinely misleading
error and cost an afternoon the first time.

So a new package is bootstrapped once, by hand, with your own credentials and
2FA:

```sh
pnpm --filter @openleaf-editor/<name> publish --access public --tag beta
node scripts/trust-publishers.mjs        # now it can be trusted
```

That is the only publish of that package's life that a human performs; every
release after it goes through the workflow. `scripts/trust-publishers.mjs`
reports such packages as `BOOTSTRAP` rather than attempting them, and the
release workflow runs `scripts/registry-preflight.mjs` before the gate so a
missing package fails in a minute with the fix in the message, instead of half
way through a publish.

`@openleaf-editor/content-policy` is the outstanding case: it was added three
hours after 0.1.0-beta.2 shipped, so it has never been published.

### The one remaining secret

`scripts/dist-tags.mjs` still needs a real token, in the repository secret
**`NPM_TOKEN`**: the credential npm mints from the OIDC exchange is valid for
`publish` and `stage publish` and nothing else, and moving a dist-tag is neither.
Use a granular token scoped to `@openleaf-editor` with read and write on
packages, and nothing else.

Two things make that acceptable. It cannot answer a 2FA prompt either, which is
why the script reads the registry first and writes only the tags that are
actually wrong. And it is a pre-1.0 artifact: once `latest` tracks a stable line
instead of the newest prerelease, publishes set `latest` implicitly, and this
step and its secret both go away.

Because of it, do **not** turn on *Publishing access → require two-factor
authentication and disallow tokens* while that step exists. It does not affect
trusted publishing, so the publish would keep working -- and the dist-tag writes
would start failing every Monday, leaving `latest` pinned to whichever
prerelease it last reached. That setting is the right end state, after 1.0.

Also check once, before trusting the first unattended run: that `main` accepts a
push from `GITHUB_TOKEN`. If branch protection rejects it, the publish will have
already succeeded and the bump commit will be stranded on the runner — either
allow the release bot through, or move the workflow to opening a release pull
request instead.

### Proving it works

`--dry-run` does not exercise the trust exchange end to end, so the first real
Monday run is the first full test of it. A trust misconfiguration fails the
publish step with a 404 or an authentication error and leaves `main` untouched
(nothing is pushed until after the publish), so the cost of getting it wrong is
a red run, not a broken release.

If it fails on a placeholder-token error rather than a trust error, check
`packageManager` in the root `package.json`: pnpm 11 briefly passed
`actions/setup-node`'s unresolved `${NODE_AUTH_TOKEN}` placeholder to the
registry as a literal token, masking OIDC behind a 404. Fixed 2026-05-15
([pnpm#11513](https://github.com/pnpm/pnpm/issues/11513)); pnpm 11.13.1 and
later carry it.

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
