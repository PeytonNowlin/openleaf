# Governance

OpenLeaf exists because the two dominant rich text editors changed their
licenses under their users. This document is the structural answer to
"how do I know you won't do the same?"

It is deliberately written so that a lawyer who has never met us can read
it and reach a conclusion.

## 1. The license is Apache-2.0, permanently

OpenLeaf is licensed under the Apache License, Version 2.0. Every package
in this repository, now and in the future, is licensed under Apache-2.0.

You may use OpenLeaf commercially, in closed-source products, in SaaS
products, and in products you sell, without payment, registration,
attribution beyond the license terms, or permission.

## 2. There is no CLA, and this is the point

OpenLeaf does **not** use a Contributor License Agreement. Contributions
are accepted under the [Developer Certificate of Origin](CONTRIBUTING.md)
(DCO), which certifies a contributor's right to submit their work but
**does not transfer copyright to anyone.**

The consequence is structural:

> Copyright in OpenLeaf stays with each contributor who wrote the code.
> It is never assigned to a maintainer, a company, or a foundation. Any
> future move to a proprietary or copyleft license would require the
> individual permission of every contributor whose work remained in the
> tree.

**Where the project actually stands today.** This section is written to
be checked, so check it: `git shortlog -sne HEAD` is the whole answer.
OpenLeaf currently has two contributors. The guarantee above has
therefore started to bind -- relicensing is no longer something any one
person can decide -- but two people can still agree, so it remains closer
to a statement about structure and intent than a practical obstacle.
Treat it as a real constraint that is not yet a strong one. Claiming more
than that would be the one claim in this document most likely to be
relied on and most damaging if wrong, so it is not claimed.

What the DCO does is decide the trajectory in advance, at the moment when
the decision is cheap and reversible. Every contributor who lands a patch
keeps their copyright, so relicensing becomes progressively harder as the
project grows, and there is no mechanism by which it becomes easier. A
CLA assigning copyright to a steward is the specific legal instrument
that makes a rug-pull possible no matter how many contributors there are.
We have declined to create one, and that decision is not ours to quietly
reverse later: adding a CLA would require every existing contributor to
sign it.

Read the guarantee, then, as what it is -- a commitment about the shape
of the project rather than a claim about its present size.

## 3. Product covenants

For as long as this project bears the name OpenLeaf:

1. **No feature gating.** There is no paid tier, premium plugin, pro
   edition, or enterprise build. If a feature exists, it is in the
   Apache-2.0 packages.
2. **No license keys.** OpenLeaf will never require, validate, check,
   or nag about a license key, activation token, or account.
3. **No phone-home.** The editor makes no network request that the
   integrator did not explicitly configure. No telemetry, no analytics,
   no usage reporting, no version check.
4. **No required cloud service.** Every feature works fully on
   infrastructure you control. OpenLeaf has no real-time collaboration
   today; if it is ever added, it ships under this covenant too, which
   means a self-hosted backend and no OpenLeaf-operated service in the
   path. Collaboration is the usual place editors put a paid cloud tier,
   so it is named here to be explicit that this covenant would cover it.
5. **No open-core.** Revenue, if any is ever sought, comes from services
   adjacent to the software -- support contracts, hosted infrastructure,
   sponsorship, prioritized development -- never from withholding
   functionality from the free version.

## 4. Content safety commitment

OpenLeaf treats silent content loss as the most serious class of defect
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

Long-term intent is to donate OpenLeaf to a neutral foundation (the
OpenJS Foundation being the natural home) once the project is mature
enough to be accepted. That step would strengthen, never weaken, the
guarantees above.

## 6. Trademark

The OpenLeaf name and logo may be used freely to refer to this project,
to state that your software uses or integrates it, and in the names of
third-party plugins (e.g. "OpenLeaf Mermaid Plugin"). They may not be
used to imply endorsement of a fork or a derived product, or in a way
that suggests your product *is* OpenLeaf.

OpenLeaf is unaffiliated with any other business using a similar name.

## 7. Amending this document

Sections 1, 2, and 3 are covenants. They may be amended to make the
guarantees stronger or clearer. They may not be amended to weaken them.
A pull request that weakens them should be closed on sight, including
one from a maintainer.
