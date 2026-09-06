#!/usr/bin/env bash
#
# The alarm for the scheduled runs nobody is watching.
#
# A red cron is invisible in a way a red pull request is not: nothing is
# blocked, nobody is requested, and the run sits in the Actions tab looking
# exactly like the green one above it. The placeholder e2e failure (#254) was
# red for six consecutive nights before anyone opened it, and the scheduled
# release of 2026-08-24 failed the same silent way. GitHub does email the cron's
# owner, which is one person, one message per failure, and the sixth is
# indistinguishable from the first.
#
# So the alarm is an issue, filed in the tracker this project already reads
# every day:
#
#   failure  open one issue, or comment on the one already open
#   success  say so on that issue and close it
#
# Self-clearing is the point. An alarm that only ever fires becomes the same
# background noise as the emails, and background noise is what let six nights
# pass. A run that goes green closes the issue itself, so an open one always
# means "the last scheduled run was red", not "someone forgot to tidy up".
#
# It owns exactly one issue: the open issue whose title matches $TITLE
# exactly. A human issue is never commented on, never closed, and never
# reopened by this script, however similar its title reads -- the match is
# string equality, not search relevance, because `gh issue list --search`
# ranks and would eventually hand back somebody's bug report.
#
# Usage, from a job with `issues: write` and GH_TOKEN in the environment:
#
#   TITLE='Nightly CI is red' RESULT='${{ needs.browser.result }}' \
#     RUN_URL=... WHAT='The nightly three-engine gate' .github/alarm.sh
#
# RESULT is a job result: `success`, `failure`, `cancelled` or `skipped`. Only
# the first two mean anything here -- a cancelled or skipped run is not
# evidence either way, so the alarm is left exactly as it is.

set -euo pipefail

: "${TITLE:?TITLE is required}"
: "${RESULT:?RESULT is required}"
: "${RUN_URL:?RUN_URL is required}"
: "${WHAT:?WHAT is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"

# The issues REST endpoint returns pull requests too -- they share the number
# space -- so pull requests are dropped before the title is compared.
number=$(
  gh api "repos/$GITHUB_REPOSITORY/issues?state=open&per_page=100" \
    --jq '[.[] | select(.pull_request == null) | select(.title == env.TITLE) | .number] | first // empty'
)

case "$RESULT" in
  success)
    if [ -n "$number" ]; then
      gh issue close "$number" --repo "$GITHUB_REPOSITORY" \
        --comment "$WHAT is green again: $RUN_URL"
      echo "cleared the alarm on #$number"
    else
      echo "green, and no alarm was open"
    fi
    ;;

  failure)
    if [ -n "$number" ]; then
      gh issue comment "$number" --repo "$GITHUB_REPOSITORY" \
        --body "Still red: $RUN_URL"
      echo "alarm already open as #$number, commented"
    else
      opened=$(
        gh issue create --repo "$GITHUB_REPOSITORY" --title "$TITLE" --label bug --body "$(
          cat <<BODY
$WHAT failed.

**Run:** $RUN_URL

This issue was opened by \`.github/alarm.sh\` because a scheduled run went red,
and it will close itself when a scheduled run goes green again. While it is
open, the last scheduled run was red. Every further failure comments here
rather than opening a second issue, so the comment count is how many runs have
failed since.

Nothing blocks on a scheduled run, so the failure is only as visible as this
issue is. If the cause turns out to be worth its own ticket -- a real product
bug rather than a flake -- file that one separately and link it here; do not
rename this issue, because the alarm finds it by exact title.
BODY
        )"
      )
      echo "raised the alarm: $opened"
    fi
    ;;

  *)
    echo "result is '$RESULT', which is neither pass nor fail -- leaving the alarm alone"
    ;;
esac
