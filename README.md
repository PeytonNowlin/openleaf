# Openleaf

**A rich text editor for the web that is actually free.** Apache-2.0, no paid
tier, no license key, no phone-home, no cloud dependency — and built so that
it cannot quietly destroy your content.

---

> ## ⚠️ Status: pre-alpha. Foundations only.
>
> This repository was started on **2026-08-18**. **Nothing here is usable in
> production yet, and there is currently no user interface at all.**
>
> **What works and is tested today**
> - The document schema and HTML in / HTML out pipeline
> - The **content-preservation layer** — the thing that stops a
>   ProseMirror-based editor from silently eating legacy markup
> - The round-trip fidelity harness: **7/7 stored fixtures fully lossless**,
>   **94 unit tests** green, typechecked strict
> - **Paste normalizers for Word and Google Docs** — reconstructs real nested
>   `<ul>`/`<ol>` from Word's `mso-list` markup, strips the vendor styling, and
>   parses to **zero** preserved atoms
> - `<openleaf-editor>` verified in **real browsers** — 15 tests across
>   Chromium, Firefox and WebKit (41 passing runs): loads stored HTML, accepts
>   typing, pastes from Word and Google Docs, writes back to the textarea, posts
>   through a real form submit, and does not alter a document that is opened and
>   saved untouched
> - A single-file bundle: **67 KB gzipped** including the whole editing engine
>
> **What does not exist yet**
> - Any toolbar or visible UI (keyboard shortcuts only)
> - Tables, images, server-side sanitizer package
> - Mobile and IME coverage — no touch, Android soft-keyboard or
>   composition-event tests yet, which is where editors break hardest
>
> I am building this in the open from the foundations up rather than shipping a
> demo and backfilling the hard parts. The roadmap below is the actual plan.

---

## Why this exists

In 2024, **TinyMCE** relicensed from LGPL-2.1 to GPLv2-or-later plus a
commercial option. **CKEditor 5** is GPL-or-commercial with license-key
validation. Both gate genuinely core features — real-time collaboration, track
changes, decent export — behind paid tiers.

| Editor | License | Catch |
|---|---|---|
| TinyMCE 7+ | GPLv2+ / commercial | Relicensed under existing users. Premium plugins paid. License-key nags. |
| CKEditor 5 | GPLv2+ / commercial | License-key validation. Collaboration is paid. |
| TipTap | MIT core | Pro extensions and collab cloud are commercial. |
| Froala | Commercial | Not open source. |

For a hospital intranet, a school district CMS, a public library, or a
three-person nonprofit's publishing tool, "open source" that resolves into
either an invoice or a copyleft obligation on your whole front end is not open
source in the way that matters.

The permissively-licensed editing **engines** already exist — ProseMirror
(MIT), Lexical (MIT), Quill (BSD). What does not exist is a
**batteries-included, framework-agnostic, drop-in editor** built on one of
them, with no commercial tier above it. That is the gap Openleaf is being
built to fill.

## What Openleaf is

Openleaf is a **drop-in replacement for TinyMCE**, built on
[ProseMirror](https://prosemirror.net) (MIT), aimed first at content
management systems rather than at React dashboards.

**Openleaf does not implement its own editing engine, and never will.**
`contenteditable` normalization — IME composition for Japanese and Korean,
Android soft-keyboard autocorrect, Safari selection collapse, undo-stack
coherence — is three to five years of specialist work that no user can see,
and ProseMirror already solved it. Time spent reinventing that is time not
spent on the parts people actually feel: the toolbar, the paste handling, the
tables, the accessibility.

The intended shape:

```
core/            schema, HTML I/O, preservation. Zero framework deps.  [done]
paste/           Word / Google Docs normalizers                        [done]
element/         <openleaf-editor> custom element — the drop-in         [done]
ui/              toolbar and dialog primitives, themed by CSS custom props
plugins-*/       one package per feature, tree-shakeable
sanitize/        one allowlist as data + matching node, php, python impls
adapters-*/      thin react, vue, svelte, angular wrappers
compat-tinymce/  a tinymce.init()-shaped façade for migrations
cli/             openleaf-lint — dry-run what this editor does to your content
```

## The commitment that defines this project

**Openleaf treats silent content loss as the most serious defect it can
ship**, ranked above crashes.

ProseMirror is schema-strict: anything it does not recognise, it discards.
Pointed at a CMS with a decade of legacy posts, that is a loaded gun. The
failure mode is not an error message — it is a customer opening a 2009
article, pressing **Save**, and losing a section of it with no warning. That
is the single most likely way a technically excellent ProseMirror-based
TinyMCE replacement fails in production, and most attempts do not take it
seriously enough.

Openleaf's answer is architectural, not aspirational:

- **Unrecognised markup is preserved, never dropped.** A
  `<div class="callout">` or a `<drupal-media>` element becomes a selectable,
  movable, deletable atom that round-trips **byte-identical**. It is an atom, so
  it has no interior caret position and cannot be half-edited into something
  invalid. Selecting one and typing replaces it — the same as typing over a
  selected image — but that is *visible* and undo restores it byte-identical.
  There is a browser test asserting exactly that. What can never happen is
  losing it **silently**, which is the failure that actually hurts.
- **The rule is "would unwrapping lose information?", not "is this tag
  known?"** A bare `<div>` unwraps, because nothing is lost. A `<div>` with
  *any* attribute is preserved, because we cannot know that attribute wasn't
  load-bearing. Over-preserving is visible and correctable. Under-preserving is
  invisible and permanent.
- **Fidelity is a measured number gated in CI**, not a claim in a README.

### Round-trip fidelity

Two corpora, two standards — because loading stored content and pasting
foreign content have *opposite* correct defaults. Conflating them is how an
editor ends up either mangling stored documents or importing a wall of
`line-height:1.38` into them.

| Corpus | Standard | Today |
|---|---|---|
| `stored/` — the customer's database, authoritative | **Lossless.** Every attribute survives, or a maintainer declared the loss in a reviewed PR. | **7/7 fully lossless** |
| `paste/` — Word, Google Docs, Excel | **Stable and text-preserving.** Stripping vendor styling is the goal, not damage. | 2/2 stable; `mso-*` and `docs-internal-guid` stripped |

```
$ pnpm test
  fixture                 corpus  stable  text  attrs
  bare-div-wrapper.html   stored    ok     ok       0
  callout-div.html        stored    ok     ok       0
  drupal-ckeditor.html    stored    ok     ok       0
  legacy-wordpress.html   stored    ok     ok       0
  nested-lists.html       stored    ok     ok       0
  rtl-content.html        stored    ok     ok       0
  semantic-baseline.html  stored    ok     ok       0
  gdocs-paste.html        paste     ok     ok       4
  word-paste.html         paste     ok     ok       5
  stored corpus: 7/7 fully lossless
```

This harness has already earned its keep. It caught `dir` being silently
dropped from paragraphs — bidirectional text direction, not styling — which
would have broken every Arabic, Hebrew, and Persian document that passed
through the editor.

**If you have gnarly real-world HTML that breaks this, that is the single most
valuable contribution you can make.** Open a PR adding it to
`packages/core/test/fixtures/stored/`.

### Paste fidelity

Word does not emit lists. It emits a flat run of paragraphs that merely *look*
like a list, with the structure hidden in a proprietary CSS property and the
bullet glyph baked in as literal text:

```html
<p class="MsoListParagraphCxSpFirst"
   style="text-indent:-.25in;mso-list:l0 level1 lfo1">
  <!--[if !supportLists]-->
  <span style="font-family:Symbol">·<span style="font:7.0pt">&nbsp; </span></span>
  <!--[endif]-->
  Revenue up 12%<o:p></o:p>
</p>
```

Openleaf turns that into real nested `<ul>`/`<ol>`, reading list identity and
depth from `mso-list`, deciding ordered-versus-unordered from the marker text
(because Word never says), then deleting the marker since a real `<li>` renders
its own. Google Docs gets its own normalizer for a different trap: it wraps
every paste in `<b style="font-weight:normal">`, a bold tag that is not bold.

The quality bar these are held to is not "did it strip the junk" but **does the
result parse to zero preserved atoms** — because unrecognised markup is
preserved as an opaque card, which is right for a customer's stored document and
wrong for a paste, where the author would see an inert grey box instead of their
list.

One deliberate asymmetry worth knowing about: the generic normalizer, which
handles pastes of unknown origin including content copied from Openleaf itself,
strips styles but **never strips classes or `data-` attributes**. An aggressive
paste cleaner reasonably might — and doing so would silently destroy preserved
markup on the most ordinary user action there is.

---

## The road ahead

Ordered by dependency, not by date. I would rather ship 100% of fifteen
features than 60% of sixty — that second thing is how this project fails, and
it is how most editor projects die.

### Phase 0 — Foundations ▸ *done*

Prove the architecture before building on it.

- [x] Monorepo, strict TypeScript, dual ESM + IIFE builds
- [x] Document schema, HTML in / HTML out
- [x] Content-preservation layer
- [x] Round-trip fidelity harness with two corpora
- [x] Governance: Apache-2.0, DCO, no-relicense covenant
- [x] CI: typecheck, fidelity, bundle-size budget, DCO gate
- [x] **Playwright across Chromium, Firefox and WebKit**

> **Done.** `<openleaf-editor>` is now proven in real browsers to load stored
> HTML, accept typing, apply marks by keyboard, write back to its bound
> textarea, and post through an ordinary form submit — and to leave a document
> byte-identical when it is opened and saved without editing.
>
> Writing these found two real bugs that every unit test had passed straight
> over: `dir` silently dropped from paragraphs (breaking all RTL content), and
> a bold shortcut that appeared to work but was never exercised because
> `Home`/`End` do not move the caret in contenteditable on macOS. This is
> exactly why jsdom is not enough.

### Phase 1 — A usable editor ▸ *in progress*

The point at which someone could actually replace TinyMCE with this.

- [ ] **Toolbar and UI primitives** — accessible by construction: real buttons,
  roving tabindex, `aria-pressed` reflecting mark state, no `div onclick`
- [x] **Paste normalizers** — Word and Google Docs done. The `mso-list` →
  real-nested-list conversion is, commercially, the single most valuable piece
  of code in this project: it is the number one reason organizations pay for
  TinyMCE. Excel and Apple Notes still to come. See
  [the paste package](packages/paste) for what Word actually emits and why
  reconstructing it is harder than it sounds.
- [ ] **Tables** — insert, delete row and column, merge, split, header rows.
  Their own package, because a CMS that forbids tables should not ship the code.
- [ ] **Images** — upload hook, alt-text prompting (not optional, not skippable),
  resize
- [ ] **`@openleaf/sanitize`** — the allowlist as *data*, plus matching Node, PHP,
  and Python implementations. Every CMS team hand-rolls this and gets it wrong.
- [ ] Source view, find and replace, alignment, colors, character count, autosave
- [ ] i18n scaffolding and a first non-English locale

> **Done when** a real site is running Openleaf in production, editors are
> filing complaints, and none of those complaints are "it destroyed my post".

### Phase 2 — Adoption ▸ *the part that decides whether this matters*

A better editor nobody can switch to has changed nothing. People do not
migrate because your editor is nicer; they migrate when migrating is cheap.

- **`compat-tinymce`** — a `tinymce.init()`-shaped façade. Turns a migration
  from a sprint into an afternoon. Highest-leverage adoption work in the project.
- **`openleaf-lint`** — point it at a content database, get a per-document
  report of exactly what would change *before* committing to a switch.
  "Tell me what this will do to my 40,000 existing posts" is the question every
  CMS owner asks and no editor vendor answers.
- **WordPress plugin** and **Drupal module** — the two biggest captive markets
  in the space. WordPress classic ships TinyMCE; Drupal ships CKEditor 5.
- Framework adapters: React, Vue, Svelte, Angular
- Documentation site with a live playground

### Phase 3 — The things everyone else charges for

- **Real-time collaboration, free.** Via [Yjs](https://yjs.dev) and
  `y-prosemirror`, both MIT. This is a paid tier at TinyMCE, CKEditor, and
  TipTap. Here it will be in the Apache-2.0 packages, running on
  infrastructure you control, with no cloud service required.
- Comments and suggestions
- Track changes
- Math, mermaid, embeds, mentions
- Accessibility checker for authored content

### Explicitly not in scope yet

Math, comments, track changes, PDF/DOCX export, spell and grammar check,
mentions, templates, AI features. Not rejected forever — deferred until the
Phase 1 core is *boringly* reliable. Saying so publicly is a feature.

### Accessibility, throughout

Target is **WCAG 2.2 AA**, verified with real screen readers and stated per
release. Openleaf will not claim a conformance level on the strength of
axe-core passing — automated tooling catches roughly a third of real barriers,
and the market that most needs a free editor (government, education,
healthcare, nonprofits) is exactly the market that legally cannot adopt an
inaccessible one. That alignment is not a coincidence worth wasting.

---

## What using it will look like

No build step. A script tag and an element.

```html
<form method="post">
  <label for="body">Post body</label>
  <openleaf-editor for="body" aria-label="Post body"></openleaf-editor>
  <textarea id="body" name="body" hidden><?= $post->body ?></textarea>
  <button type="submit">Save</button>
</form>

<script src="/js/openleaf.min.js"></script>
```

The element keeps the textarea in sync and writes to it before submit, so
server code that already reads `$_POST['body']` keeps working untouched.

Content is stored as **HTML**, not a proprietary JSON document model. A site
that adopts Openleaf and later abandons it is left with content it can still
render. Lock-in is not a retention strategy here.

**Current size:** 216 KB minified, **67 KB gzipped** for the complete drop-in,
including ProseMirror's view, state, history and keymap, plus the Word and
Google Docs paste normalizers. CI fails above 90 KB gzipped.

## Security

Client-side sanitization is a **user-experience feature, not a security
control** — anything the editor strips can be re-added with developer tools,
because the editor runs entirely under the user's control.

**You must sanitize on the server.** `@openleaf/sanitize` will ship the
canonical allowlist as data specifically so your server can enforce the same
policy in the same terms. Treating editor output as trusted HTML is a
vulnerability in *your* application, and no configuration of Openleaf can fix
it. See [SECURITY.md](SECURITY.md).

## Guarantees

[GOVERNANCE.md](GOVERNANCE.md) is the enforceable version. In short:

1. **Apache-2.0, permanently.** Commercial use, closed-source use, SaaS use,
   resale — no payment, no registration, no attribution beyond the license, no
   permission needed.

2. **No CLA, ever.** Contributions arrive under the
   [DCO](https://developercertificate.org/), so copyright stays distributed
   across every contributor who has ever had a patch merged. **Nobody holds
   enough rights to relicense this project** — not me, not a future maintainer,
   not an acquirer. That is not a promise about intentions; it is a statement
   about capabilities. A copyright-assignment CLA is the specific legal
   instrument that made the TinyMCE and CKEditor relicensing possible, and I
   have deliberately declined to create one.

3. **No feature gating, no license keys, no telemetry, no phone-home, no
   required cloud service.** If a feature exists, it is in the Apache-2.0
   packages. Revenue, if ever sought, comes from services *adjacent* to the
   software — support, hosted infrastructure, sponsorship — never from
   withholding functionality from the free version.

Long-term intent is to donate Openleaf to a neutral foundation once it is
mature enough to be accepted, which would strengthen these guarantees, never
weaken them.

## How to help right now

The most useful contributions at this stage, in order:

1. **Break the fidelity suite.** Real-world ugly HTML from your CMS — Word
   paste, 2009 WordPress, Mailchimp templates, CKEditor output. Redact anything
   private, add it to `packages/core/test/fixtures/stored/`, open a PR. If it
   fails, that is a bug found before a user found it.
2. **Mobile and IME browser coverage.** Touch selection, Android
   soft-keyboard behaviour, and composition events for Japanese, Korean and
   Chinese input. The desktop engines are covered; these are not, and they are
   where editors break hardest.
3. **Accessibility bug reports** naming the assistive technology and version.
4. **Tell me your migration blockers.** If you are stuck on TinyMCE or
   CKEditor for a specific reason, that reason should shape the roadmap. Open
   an issue.

```bash
pnpm install
pnpm exec playwright install   # first time only

pnpm test                 # unit + round-trip fidelity (fast, jsdom)
pnpm test:e2e             # real browsers: Chromium, Firefox, WebKit
pnpm -r build             # strict typecheck
node demo/build.mjs && open demo/index.html
```

Commits need a DCO sign-off — `git commit -s`. See
[CONTRIBUTING.md](CONTRIBUTING.md).

## License

[Apache-2.0](LICENSE) — chosen over MIT for its explicit patent grant, which
is what enterprise legal review actually asks about.

Openleaf is built on ProseMirror (MIT) and is not affiliated with,
endorsed by, or derived from TinyMCE, CKEditor, or any other business using a
similar name. See [NOTICE](NOTICE).
