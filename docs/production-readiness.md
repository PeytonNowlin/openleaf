# Production readiness

OpenLeaf remains beta until the evidence below is recorded. Automated checks
establish specific guarantees; they do not establish screen-reader usability,
real-device input behavior, or successful operation in a production CMS.

## Engineering work

- Make the full browser gate pass without excluding the promo-video test.
- Exercise all three browser engines on pull requests and retain failure traces.
- Require passing checks on main while preserving the automated beta-release path.
- Report draft persistence failures without interrupting editing; a failed read
  must not prevent an editor from mounting.
- Mirror application validation semantics onto the actual editable controls.
- Verify package builds, source and test types, fidelity, SSR imports, integration
  documentation, and bundle budgets together with `pnpm verify`.

## Evidence required before a stable release

| Area | Acceptance evidence | Status |
| --- | --- | --- |
| Automated gate | Full `pnpm verify` on the release candidate, no added exclusions | Local gate passed; PR CI must pass before merge |
| Screen readers | NVDA/Firefox and VoiceOver/Safari: name, help, formatting, dialogs, validation, source view, tables, and focus return | Requires human testing |
| Mobile input | Real iOS/Safari and Android/Chrome: touch selection, soft keyboard, paste, image insertion, undo, rotation | Requires real devices |
| IME | Real composition sessions with Japanese or Chinese input; no premature commands or lost text | Requires human testing |
| Native clipboard | Firefox: paste actual Word/Docs content, nested lists and tables using the system clipboard | Requires manual testing; synthetic clipboard events are unsupported in 10 existing tests |
| CMS pilot | Named application, supported environment matrix, representative legacy documents, server sanitization and uploads, save/reload/restore, and rollback exercise | Awaiting deployment target |
| Release operations | Required CI checks enforced; release identity can publish only after its full gate; package versions stay aligned | Main-only release identity configured; live enforcement recorded in [PR #260](https://github.com/PeytonNowlin/openleaf/pull/260) |

## Automated evidence for this hardening change

The local full gate passed on September 5, 2026: 1,924 unit tests and 1,279
browser tests, with the 10 existing Firefox synthetic-clipboard skips and no
added exclusions. Build, source/test types, fidelity, documentation, SSR imports,
package boundaries, and bundle budgets passed. The first full run encountered
an existing Firefox drag-selection failure; the same test then passed 10 repeat
runs and the next complete gate. This is evidence of an intermittent test or
browser issue, not proof that the underlying cause is fixed.

All 16 publishable packages were packed and installed in an isolated consumer;
all 23 JavaScript entry points imported without a DOM. The production dependency
audit reported zero known vulnerabilities after the XML parser lockfile update.
These results apply to this change; run the gate again for each release candidate.

The `release` environment allows only the `main` branch. Its
`OPENLEAF_RELEASE_KEY` write deploy key was provisioned with explicit maintainer
authorization. For rollout, merge the updated release workflow, then apply
`.github/main-ruleset.json` and verify GitHub reports active enforcement. Activating
the rules before the workflow has its push credential would break weekly release
publishing. See [Releasing](releasing.md#protected-main-and-the-release-identity).

A pilot must compare saved HTML and rendered content against the original corpus,
exercise failed uploads and failed saves, and confirm that local recovery is
clearly distinguished from a successful server save. Preserve redacted failures
as fixtures. Never submit actual customer documents to a third-party service as
part of this process.

## Manual test record

For each run record the commit, OS, device, browser and assistive-technology
versions, the task, expected result, actual result, and any issue or fixture.
A keyboard-only or emulated-mobile pass is useful additional evidence, not a
replacement for the named hardware or screen reader.

The README's beta notice stays in place until the required rows are complete.
Package versions and release tags continue to be owned by the release workflow.
