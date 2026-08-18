<p align="center">
  <img src="assets/openleaf-logo.png" alt="OpenLeaf" width="340">
</p>

<p align="center">
  <strong>A rich text editor for the web that is actually free.</strong><br>
  Apache-2.0 &middot; no paid tier &middot; no license key &middot; no phone-home &middot; no cloud dependency<br>
  &mdash; and built so that it cannot quietly destroy your content.
</p>

<p align="center">
  <a href="https://peytonnowlin.github.io/openleaf/"><strong>Try the live demo &rarr;</strong></a>
</p>

<p align="center">
  <a href="#the-toolbar">Toolbar</a> &middot;
  <a href="#round-trip-fidelity">Fidelity</a> &middot;
  <a href="#paste-fidelity">Paste</a> &middot;
  <a href="#the-road-ahead">Roadmap</a> &middot;
  <a href="#guarantees">Guarantees</a>
</p>

---

> ## ⚠️ Status: pre-alpha
>
> This repository was started on **2026-08-18**. There is now a working editor
> with a toolbar, but **it has not been used in production by anybody, and its
> accessibility has never been driven by a real screen reader.** Treat it
> accordingly.
>
> **What works and is tested today**
> - The document schema and HTML in / HTML out pipeline
> - The **content-preservation layer** — the thing that stops a
>   ProseMirror-based editor from silently eating legacy markup
> - The round-trip fidelity harness: **9/9 stored fixtures fully lossless**,
>   **138 unit tests** green, typechecked strict
> - **Paste normalizers for Word and Google Docs** — reconstructs real nested
>   `<ul>`/`<ol>` from Word's `mso-list` markup, strips the vendor styling, and
>   parses to **zero** preserved atoms
> - **A working toolbar** — 17 controls, `role="toolbar"` with a roving tabindex,
>   `Alt+F10` in and `Escape` out, live-region announcements, link and image
>   dialogs, source view, and a CSS-custom-property theme API
> - `<openleaf-editor>` verified in **real browsers** — 44 tests across Chromium,
>   Firefox and WebKit (**128 passing runs**): loads stored HTML, accepts typing,
>   pastes from Word and Google Docs, drives every toolbar control by keyboard,
>   writes back to the textarea, posts through a real form submit, and does not
>   alter a document that is opened and saved untouched
> - **`@openleaf/sanitize`** — one policy as data, generating configuration for
>   DOMPurify, Python `bleach` and PHP HTMLPurifier so every runtime enforces the
>   same rules
> - **Tables** — read and written by every deployment; editing is an opt-in
>   12.5 KB bundle that shares the core runtime rather than duplicating it
> - **Syntax highlighting and source formatting** — coloured code blocks, and a
>   source view that is indented and highlighted, in a 5.3 KB opt-in bundle
> - **Plugins can add node and mark types** — the schema is built from
>   registered extensions, not a frozen singleton
> - **File import** — drag in an HTML or text file, or Word's own "Save as Web
>   Page" export, and its lists are reconstructed. 2.2 KB.
> - Bundles: **86 KB gzipped** core, plus optional **12.5 KB** tables,
>   **5.3 KB** highlighting and **2.2 KB** import, each downloaded only if asked for
>
> **What does not exist yet**
> - Image upload (insert-by-URL only), find and replace, alignment, colours
> - `<caption>` and `<colgroup>` are dropped from tables — a known bug with a
>   test pinning it, not a design decision
> - **Screen reader testing.** The ARIA is designed and unit-tested; it has not
>   been driven by NVDA, JAWS, VoiceOver or ChromeVox. Until it has, this project
>   does not claim WCAG conformance.
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
them, with no commercial tier above it. That is the gap OpenLeaf is being
built to fill.

## What OpenLeaf is

OpenLeaf is a **drop-in replacement for TinyMCE**, built on
[ProseMirror](https://prosemirror.net) (MIT), aimed first at content
management systems rather than at React dashboards.

**OpenLeaf does not implement its own editing engine, and never will.**
`contenteditable` normalization — IME composition for Japanese and Korean,
Android soft-keyboard autocorrect, Safari selection collapse, undo-stack
coherence — is three to five years of specialist work that no user can see,
and ProseMirror already solved it. Time spent reinventing that is time not
spent on the parts people actually feel: the toolbar, the paste handling, the
tables, the accessibility.

The intended shape:

```
core/            schema, HTML I/O, preservation, commands, keymap     [done]
paste/           Word / Google Docs normalizers                       [done]
sanitize/        one policy as data + DOMPurify/bleach/HTMLPurifier   [done]
ui/              toolbar, icons, dialogs, theme tokens                 [done]
element/         <openleaf-editor> custom element — the drop-in        [done]
plugins-table/   opt-in table editing, second script tag              [done]
plugins-highlight/ opt-in syntax highlighting + source formatting     [done]
plugins-import/  opt-in file import: HTML, text, and a converter seam [done]
plugins-*/       one package per feature, tree-shakeable
sanitize/        one allowlist as data + matching node, php, python impls
adapters-*/      thin react, vue, svelte, angular wrappers
compat-tinymce/  a tinymce.init()-shaped façade for migrations
cli/             openleaf-lint — dry-run what this editor does to your content
```

## The commitment that defines this project

**OpenLeaf treats silent content loss as the most serious defect it can
ship**, ranked above crashes.

ProseMirror is schema-strict: anything it does not recognise, it discards.
Pointed at a CMS with a decade of legacy posts, that is a loaded gun. The
failure mode is not an error message — it is a customer opening a 2009
article, pressing **Save**, and losing a section of it with no warning. That
is the single most likely way a technically excellent ProseMirror-based
TinyMCE replacement fails in production, and most attempts do not take it
seriously enough.

OpenLeaf's answer is architectural, not aspirational:

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
| `stored/` — the customer's database, authoritative | **Lossless.** Every attribute survives, or a maintainer declared the loss in a reviewed PR. | **9/9 fully lossless** |
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
  stored corpus: 9/9 fully lossless
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

OpenLeaf turns that into real nested `<ul>`/`<ol>`, reading list identity and
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
handles pastes of unknown origin including content copied from OpenLeaf itself,
strips styles but **never strips classes or `data-` attributes**. An aggressive
paste cleaner reasonably might — and doing so would silently destroy preserved
markup on the most ordinary user action there is.

---

## The toolbar

> [**Try it live**](https://peytonnowlin.github.io/openleaf/) — including a
> one-click "paste a Word document" demonstration that pushes genuine Word
> clipboard HTML through the editor so you can see the `mso-list` reconstruction
> happen.

Seventeen controls — sixteen buttons and a block-type select — grouped and
separated:

```
[ undo redo | Paragraph ▾ | B I U S <> | • 1. " {} | link unlink img — | </> ]
   history     block type     marks       blocks       insertions      source
```

History sits leftmost because it is what an author reaches for under stress and
muscle memory puts it there in every office application. Source view sits
rightmost and alone, because it changes the editor's *mode* rather than the
document.

### The keyboard model

| | |
|---|---|
| `Alt+F10` | move focus into the toolbar (same as TinyMCE and CKEditor, so muscle memory transfers) |
| `Escape` | return focus **and the selection** to the content, from anywhere in the toolbar |
| `←` `→` | move between buttons |
| `Home` `End` | first / last button |
| `Tab` | leaves the editor entirely — never captured |

The whole toolbar is **one tab stop**. Without that, Tab from the editable
region walks a keyboard user through sixteen buttons before they reach their own
content.

Two details that took a review to get right, both written up in
[docs/toolbar-design-review.md](docs/toolbar-design-review.md):

- **Arrow-key roving applies only to `<button>` elements.** The block-type
  control is a native `<select>`, where Left/Right have two competing owners.
  It is a separate tab stop that keeps its own native key handling.
- **Formatting changes are announced.** One polite, atomic, visually-hidden live
  region says "Bold on" / "Bold off" — but only on a real formatting transition,
  never when the cursor merely moved through already-bold text. `Ctrl+B` typed in
  the content happens nowhere near the Bold button, so without this nothing
  observes the change.

Disabled controls use `aria-disabled`, never the `disabled` attribute: a disabled
button drops out of the roving tabindex and becomes undiscoverable to a screen
reader user.

### Theming

Set custom properties. No forking, no `!important`, no internals touched:

```css
.my-cms openleaf-editor {
  --openleaf-color-accent: #6f42c1;
  --openleaf-color-surface: #fbfbfd;
  --openleaf-button-size: 36px;
  --openleaf-radius: 8px;
  --openleaf-z-index: 100;       /* above a sticky admin bar */
  --openleaf-focus-width: 3px;   /* thickness, not just colour */
}
```

The full public token set: `--openleaf-font-ui`, `--openleaf-font-mono`,
`--openleaf-font-size`, `--openleaf-radius`, `--openleaf-color-text`,
`--openleaf-color-text-muted`, `--openleaf-color-surface`,
`--openleaf-color-surface-hover`, `--openleaf-color-surface-active`,
`--openleaf-color-border`, `--openleaf-color-accent`, `--openleaf-color-focus`,
`--openleaf-focus-width`, `--openleaf-focus-offset`, `--openleaf-button-size`,
`--openleaf-icon-size`, `--openleaf-gap`, `--openleaf-z-index`.

Light and dark are both built in and follow `prefers-color-scheme`;
`prefers-reduced-motion` and `forced-colors` are respected, with the pressed
state re-expressed as a border under forced colours since that mode discards
backgrounds.

### Choosing the controls

```html
<!-- a comment box needs four buttons, not eighteen -->
<openleaf-editor for="comment" toolbar="bold italic | link | undo redo"></openleaf-editor>

<!-- no toolbar at all -->
<openleaf-editor for="title" toolbar="none"></openleaf-editor>
```

Plugins declare *capability*, integrators declare *layout*. A plugin registers a
button; the `toolbar` attribute decides whether and where it appears. So
installing a plugin never silently rearranges somebody's toolbar:

```js
import { registerToolbarItem } from '@openleaf/ui'

registerToolbarItem({
  id: 'insertTable',
  type: 'button',
  label: 'Insert table',
  icon: 'bulletList',
  command: insertTable,
  isEnabled: (state) => canInsert(state, 'table'),
})
```

For state a predicate cannot derive — an upload in flight, a collaborative lock
held by someone else — push it instead: `editor.toolbar.setItemState('id',
{ enabled: false })`.

### Content Security Policy

Styles ship as a **constructable stylesheet** attached via
`document.adoptedStyleSheets`. CSP gates resources *parsed as style*, and a CSSOM
object attached this way never passes through that gate — so the toolbar styles
itself under `style-src 'self'` with no `'unsafe-inline'`, which is what
government and enterprise integrators actually run. There is deliberately **no
`<style>` injection fallback**: it is blocked by exactly the policies that would
need it, and it fails silently. If `adoptedStyleSheets` is unavailable you get a
console warning naming `@openleaf/ui/openleaf.css` to link instead.

No `innerHTML` anywhere in the UI package either, so Trusted Types
(`require-trusted-types-for 'script'`) does not block the icon sprite.

---

## Tables

<a id="tables"></a>

Tables are the clearest case of a design decision the tests overturned, so it is
worth writing down.

The plan was to put tables entirely in an opt-in package, so that a CMS
forbidding tables ships none of the code. Then the fidelity harness answered the
question that actually mattered: **without table node types in the base schema, a
`<table>` in stored content is claimed by the preservation layer and becomes a
single opaque atom.** It round-trips perfectly and it cannot be edited. An author
opening a decade-old post finds a grey card where their table used to be, and
"we read your tables but you may not touch them" is not a thing you can tell a
CMS.

So the split moved:

| | Where | Cost |
|---|---|---|
| Table **schema** — parse, serialize, legacy attributes, `scope`, `colspan` | Always in core | ~4 KB |
| Table **editing** — cell selection, column resizing, row/column commands, toolbar | Opt-in bundle | 12.5 KB gzipped |

Two script tags, and the order matters:

```html
<script src="/js/openleaf.min.js"></script>
<script src="/js/openleaf-tables.min.js"></script>
```

The second bundle **borrows the first one's ProseMirror runtime** rather than
carrying its own. That is what keeps it 12.5 KB instead of ~200 KB, but the real
reason is correctness: two copies of ProseMirror means two schemas, and a table
node built by the plugin would be a different node type than the editor accepts —
a failure that is very hard to read from the symptoms.

Or as modules, where the bundler handles it:

```ts
import { installTableEditing } from '@openleaf/plugins-table'
installTableEditing()
```

The editor picks up plugins registered after it was created, so a deferred or
code-split bundle still works. Without that, table buttons would appear and do
nothing.

### What tables keep

Legacy presentational attributes — `border`, `cellpadding`, `cellspacing`,
`width`, `align` — are preserved, which a clean-slate schema would not do. They
are how HTML expressed table styling for fifteen years, they are everywhere in
the content this editor inherits, and dropping them changes how a page renders.

`scope` on header cells is kept for a more important reason: it is what tells a
screen reader which cells a header governs. Dropping it turns a navigable table
into a grid of unrelated numbers. Inserting a table gives it a header row by
default for the same reason — a table without headers is an accessibility problem
authors rarely go back and fix, and defaults decide what most documents look
like.

`<td>text</td>` also round-trips exactly, rather than becoming
`<td><p>text</p></td>`. Cells hold block content because real tables contain
paragraphs and lists, so a bare-text cell parses to a cell containing a
paragraph — and writing that back would rewrite every cell of every table in an
archive the first time each post was opened. A cell holding exactly one
attribute-free paragraph is unwrapped on the way out.

### Known bug, not a limitation

**`<caption>` and `<colgroup>` are dropped.** Dropping a caption is a real
accessibility regression — a caption is a table's accessible name. It cannot be
modelled today because `prosemirror-tables` computes its cell map by treating
every child of a table as a row, so a leading caption node breaks its indexing.
There is a test pinning the current behaviour so it cannot quietly get worse, and
the fix is a caption node plus an upstream change rather than a decision to live
with.

---

## Syntax highlighting and source formatting

A second opt-in bundle, **5.3 KB gzipped**. It colours code blocks and formats
the HTML source view — and the formatting is arguably the bigger win, because the
editor serializes to one long line, which is correct output and unreadable
source.

```html
<script src="/js/openleaf.min.js"></script>
<script src="/js/openleaf-highlight.min.js"></script>
```

### Formatting is verified, not trusted

Reindenting HTML can change what it means. Whitespace inside `<pre>` is content;
whitespace inside a paragraph's inline content becomes a space. So the
reformatted text is only ever shown after it has been **proved to parse to the
same document**, and the original is used when that check fails. A formatter that
cannot demonstrate it preserved your document does not get to touch it.

The first attempt was a regex scanner and it broke on four of the nine real
fidelity fixtures, all for one reason: it could not tell schema-native structure
from preserved markup. `<div class="callout">` is captured verbatim by the
preservation layer, so reindenting its interior changes the stored document — and
a tag name alone cannot tell you which kind of `div` you are looking at. The
formatter walks the element tree instead, and only ever reformats block elements
the schema itself emits.

### The highlighter is a seam, not a fixture

Measured before deciding:

| | Size | Dependencies | Languages |
|---|---|---|---|
| Built-in tokenizer | **1.9 KB** gzip | none | HTML, CSS, JS |
| refractor + 3 languages | 14.0 KB gzip | 19 | ~300 available |

Neither is obviously right, because the two uses differ. A **source view** shows
the editor's own HTML — three languages is the complete set, not a compromise. A
**code block** can contain anything, and shipping three languages while calling
it syntax highlighting is a poor experience for someone writing Python.

So the default is small and honest about its coverage, and the seam is public:

```ts
import { setHighlighter } from '@openleaf/plugins-highlight'
setHighlighter((source, language) => /* Prism, refractor, highlight.js … */)
```

Same shape as [`@openleaf/sanitize`](packages/sanitize), which ships a policy and
lets you enforce it with DOMPurify. The valuable thing is the integration point,
not a reimplementation of somebody else's decade of work. The seam is tested by
driving it with refractor, because an extension point nobody has run is one that
does not work.

### What it does not do

JSX, TypeScript type syntax and decorators are not modelled by the built-in
tokenizer, and regex-versus-division is a heuristic. Every one of those degrades
to "this run is plain text", never to a wrong document — guaranteed by the test
that concatenating every token reproduces the input byte for byte.

Highlighting is applied as ProseMirror **decorations**, so the document is never
touched. Nothing here can alter what gets stored; the worst a bug can do is
colour something oddly.

---

## Importing files

An opt-in bundle, **2.2 KB gzipped**. Adds a toolbar button and drag-and-drop.

```html
<script src="/js/openleaf.min.js"></script>
<script src="/js/openleaf-import.min.js"></script>
```

**HTML and plain text import with no dependency at all** — and that covers more
than it sounds, because Word's own *Save as Web Page* produces exactly the
`mso-list` markup the paste normalizer was written to reconstruct. So importing
an HTML file already gets you real nested lists out of a Word document, for zero
extra bytes.

Imported content is **inserted at the cursor, never used to replace the
document**. Replacing is something an author can do by selecting all first;
silently discarding their work is not recoverable by any amount of care
afterwards. It also goes through the *same* paste pipeline as everything else,
rather than a second one — two code paths normalizing the same markup is how one
of them rots.

### `.docx` is a seam, not a bundled dependency

Measured before deciding: **mammoth is 122 KB gzipped — larger than the entire
editor.** Forcing that on someone who wants to import an HTML file is the wrong
trade, and writing a worse OOXML converter to avoid it is a much worse one. So it
arrives through a converter:

```ts
import mammoth from 'mammoth/mammoth.browser.js'
import { registerFileConverter } from '@openleaf/plugins-import'

registerFileConverter(async (file) => {
  if (!file.name.toLowerCase().endsWith('.docx')) return null
  const { value, messages } = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() })
  return { html: value, warnings: messages.filter((m) => m.type === 'warning').map((m) => m.message) }
})
```

Tested by actually driving it with mammoth against a real `.docx` fixture, which
produces `<h1>`, `<ul>` and `<strong>` — because an extension point nobody has
run is one that does not work.

Conversion warnings are **shown to the author**, not logged. Someone importing a
document needs to know its images did not come across *now*, while they still
have the original open.

### There is deliberately no PDF import

PDF is a *layout* format. It stores positioned glyphs, not paragraphs — there is
no heading, no list and no table in a PDF, only text arranged to look like one.
Every converter therefore guesses, and the guesses fail the same way: line breaks
become paragraph breaks, headings become bold paragraphs or nothing, multi-column
layouts interleave, and tables arrive as a run of unrelated numbers.

A feature called "import" that reliably destroys structure is the failure this
project exists to avoid, with the user's permission attached. If you need the
words out of a PDF, register a converter that says *extract text* and makes no
structural claim — the seam is there, and naming it honestly is the whole
difference.

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

- [x] **Toolbar and UI primitives** — real buttons, roving tabindex,
  `aria-pressed` reflecting mark state, no `div onclick`. Every button is a
  ProseMirror command plus a selection predicate from `@openleaf/core`, so the
  toolbar package holds no editing knowledge and a plugin, a keyboard shortcut
  and a test all drive the editor the same way a button does. See
  [the toolbar section](#the-toolbar) and
  [docs/toolbar-design-review.md](docs/toolbar-design-review.md).
- [x] **Paste normalizers** — Word and Google Docs done. The `mso-list` →
  real-nested-list conversion is, commercially, the single most valuable piece
  of code in this project: it is the number one reason organizations pay for
  TinyMCE. Excel and Apple Notes still to come. See
  [the paste package](packages/paste) for what Word actually emits and why
  reconstructing it is harder than it sounds.
- [x] **Tables** — insert, delete row and column, merge, split, header rows,
  column resizing. Opt-in as a second script tag. See
  [the tables section](#tables) for why the split is not where it looks like it
  should be.
- [ ] **Images** — upload hook and resize. Insert-by-URL with alt-text
  prompting already works.
- [x] **`@openleaf/sanitize`** — the allowlist as *data*, generating config for
  DOMPurify, `bleach` and HTMLPurifier. Every CMS team hand-rolls this in each
  language and discovers the divergence when something gets through the weakest
  one.
- [x] Source view, with opt-in formatting and syntax highlighting
- [ ] Find and replace, alignment, colors, character count, autosave
- [ ] i18n scaffolding and a first non-English locale

> **Done when** a real site is running OpenLeaf in production, editors are
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
release. OpenLeaf will not claim a conformance level on the strength of axe-core
passing — automated tooling catches roughly a third of real barriers, and the
market that most needs a free editor (government, education, healthcare,
nonprofits) is exactly the market that legally cannot adopt an inaccessible one.
That alignment is not a coincidence worth wasting.

**Where that stands today, stated plainly:** the toolbar's ARIA is designed
against the APG toolbar pattern, reviewed before it was written, and covered by
29 browser tests that drive it entirely by keyboard. It has **not** been driven
by a real screen reader. Until it has, there is no conformance claim to make.
The testing matrix and the known open items are in
[docs/toolbar-design-review.md](docs/toolbar-design-review.md); the priority
order is NVDA + Firefox, JAWS + Chrome, VoiceOver + Safari, then ChromeVox on
ChromeOS — which is not optional, because K-12 is majority Chromebook.

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
that adopts OpenLeaf and later abandons it is left with content it can still
render. Lock-in is not a retention strategy here.

**Current size:** 266 KB minified, **84 KB gzipped** for the core bundle —
editing engine, paste normalizers, toolbar, icons, dialogs and the table schema.
Optional table *editing* is a further **12.5 KB**, downloaded only by sites that
load it.

The gate fails above 90 KB gzipped for the core bundle, so there is **6 KB of
headroom left**. Alignment, colours and find-and-replace have to fit in that, or
follow tables out into opt-in bundles. The plugin mechanism now exists, so that
is a realistic option rather than a refactor.

OpenLeaf's own code is 45 KB of the 253 KB raw total; the other 82% is the
ProseMirror engine. `node demo/build.mjs --sizes` prints the per-package
breakdown, because an aggregate gate tells you the bundle no longer fits but not
which feature spent the budget — so the blame lands on whatever shipped last:

```
prosemirror-view      95.8 KB      @openleaf/ui        27.0 KB
prosemirror-model     43.9 KB      @openleaf/core       8.4 KB
prosemirror-transform 30.2 KB      @openleaf/paste      6.1 KB
prosemirror-state     11.6 KB      @openleaf/element    3.7 KB
```

## Security

Client-side sanitization is a **user-experience feature, not a security
control** — anything the editor strips can be re-added with developer tools,
because the editor runs entirely under the user's control.

**You must sanitize on the server.**
[`@openleaf/sanitize`](packages/sanitize) ships the canonical allowlist as data
so your server enforces the same policy in the same terms, and generates
configuration for DOMPurify, Python `bleach` and PHP HTMLPurifier from it.
Treating editor output as trusted HTML is a vulnerability in *your* application,
and no configuration of OpenLeaf can fix it.

We deliberately do **not** ship a novel sanitizer. The valuable artifact is
agreement — one policy four runtimes enforce identically — not another
hand-rolled parser competing with implementations that have had years of
adversarial attention.

**The trap worth knowing about:** the preservation layer keeps markup the schema
does not recognise, and a default-safe policy will strip exactly that markup,
destroying the content on the server that the editor worked to save. Extend the
policy with `policyForPreserved()` if you rely on it. See
[SECURITY.md](SECURITY.md).

The editor itself refuses to preserve executable content — `<script>`,
`<iframe>`, `<object>`, `<form>`, inline `on*` handlers and `javascript:` URLs
are dropped in core, with tests. That is defence in depth, not a substitute for
sanitizing on the server.

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

Long-term intent is to donate OpenLeaf to a neutral foundation once it is
mature enough to be accepted, which would strengthen these guarantees, never
weaken them.

## Extending the schema

A plugin can contribute node and mark types:

```ts
import { registerSchemaExtension } from '@openleaf/core'

registerSchemaExtension({
  id: 'acme/callout',
  nodes: {
    callout: {
      content: 'block+',
      group: 'block',
      attrs: { level: { default: 'info' } },
      parseDOM: [{ tag: 'aside.callout', getAttrs: (dom) => ({ level: dom.dataset.level }) }],
      toDOM: (node) => ['aside', { class: 'callout', 'data-level': node.attrs.level }, 0],
    },
  },
})
```

Four decisions in that API are worth the explanation, because each of them
prevents a specific failure:

**A document's schema is fixed when its editor is built.** `EditorState.reconfigure`
can swap plugins into a live editor but cannot change its schema — so extensions
must register before the editor exists. Custom-element upgrade runs *before* the
next `<script>` tag, which would make that impossible for the documented
two-script-tag integration, so the element defers building its view until the
document's scripts have run. Register later and you get a warning naming the
problem, not a node type that mysteriously never appears.

**Extensions are appended, never prepended, and there is no positioning hint.**
Measured: a prepended block node becomes the document's `defaultType`, so every
new document would start with a plugin's widget instead of a paragraph.

**There is no priority field.** The preservation catch-all sits at priority 0 and
1, so a default-priority rule already wins. A knob would invite an author to set
`priority: 0` to be polite and thereby tie with the catch-all. `createSchema`
rejects any rule at priority ≤ 1 and explains why.

**Name collisions throw** — deliberately the opposite of toolbar items, which are
last-wins because a button is UI and replacing one is a feature. A node type is a
*storage format*: two definitions of `footnote` mean two serializations of the
same content chosen by script-tag order, and whichever loses has already written
documents in its shape. `replaces: ['footnote']` is the explicit opt-in.

### Claiming a tag would otherwise narrow fidelity

Before your node existed, the preservation layer kept that element and **every
attribute on it**. Afterwards a spec keeps only what it declares — so a callout
modelling `class` would silently drop the `id` and `data-analytics` that used to
survive.

So unmodelled attributes are captured on parse and merged back on serialize, by
default, at schema-build time — which means an author cannot opt out by
forgetting. Set `carryUnknownAttributes: false` if you genuinely want the strict
behaviour.

### `schema` was deleted, not deprecated

`@openleaf/core` used to export a `Schema` instance. It no longer does, and that
was the point of the refactor: a retained const typechecks and then fails in the
field, because a node built from one schema instance is rejected by a document
built from another. Use `state.schema` inside a command, or `coreSchema()`
outside one. `pnpm verify` fails if anything outside core imports a schema
instance.

## Writing a plugin

[**docs/authoring-plugins.md**](docs/authoring-plugins.md) is the guide. It covers
the three delivery models, a worked example that contributes a node type, and —
the part worth reading even if you skim the rest — the interactions that will
bite you:

- **The preservation catch-all.** A selector typo, or a `getAttrs` that returns
  `false`, falls through to the preservation layer. `serializeHtml` then returns
  *byte-identical HTML* and the fidelity suite passes, while your node is
  silently uneditable. Only a node-type assertion catches it.
- **The moment you claim a tag, you own every attribute anyone put on it.**
  Preserved markup keeps everything; a node spec keeps what it models. Adding a
  node type therefore *reduces* fidelity for that tag unless you carry the rest.
- **Sanitization.** A plugin that introduces an element must document the
  `policyForPreserved()` addition its users need, or their content dies on the
  server.

### What a plugin can and cannot do today

| | |
|---|---|
| ProseMirror plugins, toolbar buttons, icons, commands | Work |
| Push state a predicate cannot derive | Works, per editor |
| **Add a node or mark type** | Works — `registerSchemaExtension` |
| Dropdowns, colour grids, popovers | Not implemented; warns and renders as a button |
| Contribute CSS | No extension point yet |
| Shadow a core keyboard binding | Not possible; plugin keymaps are appended last |

A plugin that throws cannot take the editor with it: predicates fall back to
"unavailable", a failing factory contributes nothing, and persistence runs before
any chrome renders — so a broken plugin cannot stop the document reaching the
server.

## How to help right now

The most useful contributions at this stage, in order:

1. **Break the fidelity suite.** Real-world ugly HTML from your CMS — Word
   paste, 2009 WordPress, Mailchimp templates, CKEditor output. Redact anything
   private, add it to `packages/core/test/fixtures/stored/`, open a PR. If it
   fails, that is a bug found before a user found it.
2. **Run a screen reader over the toolbar.** NVDA, JAWS, VoiceOver or ChromeVox
   — say which and which version, and tell us what it actually said. This is the
   single highest-value contribution available right now: the ARIA is designed
   and keyboard-tested, and nobody has listened to it.
3. **Mobile and IME browser coverage.** Touch selection, Android soft-keyboard
   behaviour, and composition events for Japanese, Korean and Chinese input. The
   desktop engines are covered; these are not, and they are where editors break
   hardest. Specifically suspect: the `mousedown` + `preventDefault` trick that
   keeps focus in the content has a history of interfering with VoiceOver's
   synthesized touch activation on iOS.
4. **Accessibility bug reports** naming the assistive technology and version.
5. **Tell me your migration blockers.** If you are stuck on TinyMCE or
   CKEditor for a specific reason, that reason should shape the roadmap. Open
   an issue.

The fastest way to try it is [the hosted demo](https://peytonnowlin.github.io/openleaf/) —
no clone, no install. To work on it:

```bash
pnpm install
pnpm exec playwright install   # first time only

pnpm verify                    # the whole gate. ~20 seconds.
```

`pnpm verify` runs four checks and is the single command that matters:

| | |
|---|---|
| typecheck | strict TypeScript across every package |
| unit tests | 138 tests including both round-trip fidelity corpora |
| browser tests | 44 tests across Chromium, Firefox and WebKit against the real bundle |
| bundle size | fails above 90 KB gzipped |

Narrower loops while working:

```bash
pnpm verify:quick    # same gate, chromium only
pnpm test            # unit + fidelity only (~1s)
pnpm test:e2e:quick  # browsers, chromium only
pnpm test:e2e:ui     # Playwright's interactive runner
node demo/build.mjs && open demo/index.html
```

### A note on CI

**GitHub Actions is deliberately manual-only right now** (`workflow_dispatch`).
The workflow is intact and is the same four checks; it simply does not fire on
push. Installing three browser engines with system dependencies on a remote
runner took over fifteen minutes, while the identical gate takes thirteen
seconds locally — at this stage the wait was costing more than it caught.

Run it on demand with `gh workflow run ci.yml`, and see the comment at the top
of `.github/workflows/ci.yml` for the two lines that restore push triggers.
Push-triggered CI goes back on before this project accepts outside
contributions, because at that point the tradeoff inverts.

Commits need a DCO sign-off — `git commit -s`. See
[CONTRIBUTING.md](CONTRIBUTING.md).

## License

[Apache-2.0](LICENSE) — chosen over MIT for its explicit patent grant, which
is what enterprise legal review actually asks about.

OpenLeaf is built on ProseMirror (MIT) and is not affiliated with,
endorsed by, or derived from TinyMCE, CKEditor, or any other business using a
similar name. See [NOTICE](NOTICE).
