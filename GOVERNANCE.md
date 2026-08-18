# Governance

Openleaf exists because the two dominant rich text editors changed their
licenses under their users. This document is the structural answer to
"how do I know you won't do the same?"

It is deliberately written so that a lawyer who has never met us can read
it and reach a conclusion.

## 1. The license is Apache-2.0, permanently

Openleaf is licensed under the Apache License, Version 2.0. Every package
in this repository, now and in the future, is licensed under Apache-2.0.

You may use Openleaf commercially, in closed-source products, in SaaS
products, and in products you sell, without payment, registration,
attribution beyond the license terms, or permission.

## 2. There is no CLA, and this is the point

Openleaf does **not** use a Contributor License Agreement. Contributions
are accepted under the [Developer Certificate of Origin](CONTRIBUTING.md)
(DCO), which certifies a contributor's right to submit their work but
**does not transfer copyright to anyone.**

The consequence is the guarantee:

> Copyright in Openleaf is distributed across every contributor who has
> ever had a patch merged. No individual, company, or foundation holds
> sufficient rights to relicense the project. A future maintainer who
> wanted to move Openleaf to a proprietary or copyleft license could not
> do so without the individual permission of every contributor.

This is not a promise about our intentions. It is a statement about our
capabilities. A CLA that assigns copyright to a steward is the specific
legal instrument that makes a rug-pull possible; we have declined to
create one.

## 3. Product covenants

For as long as this project bears the name Openleaf:

1. **No feature gating.** There is no paid tier, premium plugin, pro
   edition, or enterprise build. If a feature exists, it is in the
   Apache-2.0 packages.
2. **No license keys.** Openleaf will never require, validate, check,
   or nag about a license key, activation token, or account.
3. **No phone-home.** The editor makes no network request that the
   integrator did not explicitly configure. No telemetry, no analytics,
   no usage reporting, no version check.
4. **No required cloud service.** Every feature, including real-time
   collaboration, works fully on infrastructure you control.
5. **No open-core.** Revenue, if any is ever sought, comes from services
   adjacent to the software -- support contracts, hosted infrastructure,
   sponsorship, prioritized development -- never from withholding
   functionality from the free version.

## 4. Content safety commitment

Openleaf treats silent content loss as the most serious class of defect
it can ship, ranked above crashes and above security issues that do not
involve data destruction. See `packages/core/src/preserve.ts` and the
round-trip fidelity suite. A change that reduces the published fidelity
pass rate cannot be merged without an explicit, documented, maintainer
decision recorded in the pull request.

## 5. Decision making

The project is currently maintainer-led. As the contributor base grows,
this section will be replaced with a documented committer model. Until
then: maintainers decide, publicly, in issues and pull requests, with
reasoning written down.

Long-term intent is to donate Openleaf to a neutral foundation (the
OpenJS Foundation being the natural home) once the project is mature
enough to be accepted. That step would strengthen, never weaken, the
guarantees above.

## 6. Trademark

The Openleaf name and logo may be used freely to refer to this project,
to state that your software uses or integrates it, and in the names of
third-party plugins (e.g. "Openleaf Mermaid Plugin"). They may not be
used to imply endorsement of a fork or a derived product, or in a way
that suggests your product *is* Openleaf.

Openleaf is unaffiliated with any other business using a similar name.

## 7. Amending this document

Sections 1, 2, and 3 are covenants. They may be amended to make the
guarantees stronger or clearer. They may not be amended to weaken them.
A pull request that weakens them should be closed on sight, including
one from a maintainer.
