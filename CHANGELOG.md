# Changelog

All notable changes to OpenLeaf are recorded here.

The repository is a monorepo and every `@openleaf-editor/*` package shares one
version number, so one entry describes the whole release. Keep all packages on
the same version.

This project follows [Semantic Versioning](https://semver.org/). While the
version is `0.x`, minor and pre-release bumps may contain breaking changes; the
entries below say so explicitly when they do.

## Unreleased

### Fixed

- **`<a id>` wrapping visible text no longer deletes that text.** `named_anchor`
  is an empty atom (TinyMCE-style jump targets). Its parse rule claimed any
  `<a>` with `id` and no `href`, so `<h2><a id="sec">Title</a></h2>` serialized
  as an empty heading. Contentful `<a id>` is now a `link` mark carrying only
  `id`; empty and whitespace-only `<a id="jump"></a>` is still the atom;
  `<a id href>` is still a link; `<a name>` is still unmatched.

### Added

- **Typography toolbar controls in `@openleaf-editor/ui`** — font family, font
  size and line height as native selects, plus indent and outdent buttons. All
  five ship in the default toolbar layout and use the core commands that were
  already modelling the storage format. Indent and outdent also appear in the
  Format menu. `type: 'select'` is a declarative contract -- `options`,
  `getValue`, `applyValue` -- for a fixed preset list.
- **`@openleaf-editor/content-policy`**, a new dependency-free package holding the
  URL, CSS and embed rules. `core` and `sanitize` both import it now. They answer
  the same questions from opposite sides of the wire, and `sanitize` deliberately
  does not depend on `core` so a server needing only the policy need not install
  ProseMirror -- which for a while meant the rules were written twice and kept
  honest by a test comparing the copies. One definition now.
- Framework entry points are importable without a DOM, checked by
  `pnpm test:ssr-imports`, and the Angular wrapper compiles against the real
  `@angular/core` types rather than an ambient shim.

### Changed

- **`serializeHtml` unwraps a sole attribute-free paragraph in list items,
  blockquotes and `<details>` bodies**, the same pass table cells already had.
  Opening and saving `<ul><li>a</li></ul>` no longer rewrites it as
  `<li><p>a</p></li>`, which changed list height and which CSS rules matched.
  Mixed content (a list item that is a paragraph plus a nested list) still keeps
  the outer wrapper; only a container whose entire modelled content is that one
  paragraph unwraps. A list inside preserved markup is still left byte-identical.
- **`toDOMPurifyConfig` now withholds `style` as well as `iframe` by default**,
  and `configureDOMPurify(purify, policy)` installs both hooks and enables both
  features in one call. Previously `style` was allowed globally with an
  instruction to install `styleAttributeHook` yourself, and forgetting it let
  `position:fixed;inset:0` through -- an invisible hole. Forgetting the hook now
  costs alignment and colour, which is visible and correctable. A config and the
  hooks it depends on can no longer disagree.
- The block-type control is a registered item with its own renderer rather than a
  special case inside the toolbar, so no built-in control needs an id-specific
  branch. `focusable` lets a rendered control name its focus target for the
  roving tabindex.
- Registry reset helpers moved behind `@openleaf-editor/core/testing` and
  `@openleaf-editor/ui/testing`, so test-only surface is not part of the package's
  public API.
- The core bundle's gzip budget rises to 110 KB, measured at 108.0.

## 0.1.0-beta.2 - 2026-08-19

The formatting and structure release. Five new packages, so read the install
section of the README before upgrading, and keep every `@openleaf-editor/*`
package on this version -- they pin each other exactly.

### Added

- **`@openleaf-editor/plugins-session`** — find and replace, word count, autosave
  with restore, an unsaved-changes warning, and save, print, preview and new
  document. Save prefers an integrator callback, then a form submission, then a
  cancelable `openleaf:save` event; it never invents a server.
- **`@openleaf-editor/plugins-insert`** — insert media, details/summary, anchors,
  a character map and emoji grid, snippets, and in-editor image resize. The
  storage format for all of it is in core, so stored `<figure>`, `<details>`,
  `<video>` and allowlisted `<iframe>` embeds stay editable rather than becoming
  opaque preserved atoms; the plugin is the editing chrome.
- **Editor chrome in `@openleaf-editor/ui` and the element** — a menubar,
  context menus for links, images and tables, floating selection and insert
  toolbars, a keyboard-shortcut dialog on F1, visual aids for empty blocks and
  non-breaking spaces, autolinking on space or Enter, `content-css` for loading
  the host's own stylesheet into the editor, `inline` and `autoresize`, UI
  translations via `lang` plus `registerTranslations`, and honouring
  `contenteditable="false"` in stored markup.
- **Framework wrappers** — `@openleaf-editor/react`, `@openleaf-editor/vue` and
  `@openleaf-editor/angular`. Each is a thin host that forwards attributes and
  re-emits `openleaf:change`; the custom element remains the editor, so no
  framework tree can fork the schema.
- **Typography, in the schema rather than in a plugin** — font family and size,
  line height, first-line indent, text direction, per-run language, subscript and
  superscript, and list styles, with `clearFormatting` to remove them. Same
  reasoning as the colour marks: without them an inherited
  `<span style="font-family:Georgia">` or a `<font face="Verdana">` is claimed by
  the preservation layer and becomes an uneditable atom. **No toolbar controls
  ship with this.** Subscript, superscript, indent and outdent have keyboard
  shortcuts and appear in the F1 list; the rest are commands exported from
  `@openleaf-editor/core` for an integrator to wire up. The storage format landed
  first on purpose -- content already in an archive cannot wait for a dropdown --
  and the README says exactly what is reachable how.
- **Table editing** — table, row and cell property dialogs (border, padding,
  background, alignment, width), a caption dialog, column-width fields with a
  sync from column resize onto stored `<col>` elements, a context menu
  (right-click / Shift+F10), an insert-size grid, nested tables, and cell
  vertical alignment including folding inherited `style="vertical-align:…"` into
  the attribute the dialog edits.
- **`<source>` and `<track>` on video and audio**, stored as scrubbed markup on
  the media node.
- **Click-to-activate for video in the editor.** A player renders as an inert
  preview -- no control bar, no pointer events -- because native media chrome
  takes those events for itself, and Firefox takes them for the whole element:
  nothing in the editor sees the click, ProseMirror never makes a node selection,
  and a player that cannot be selected cannot be edited. The preview stays the
  default for that reason, and a selected video now carries a play button of the
  plugin's own. Pressing it hands that one element its controls and its pointer
  events back; moving the selection away, or pressing Escape, returns it to a
  preview and pauses it -- so at most one player is live, and no clip is left
  playing with nothing able to stop it. Stored HTML is serialized from the node
  rather than the editing DOM, so `controls` round-trips untouched in either
  state. Covered on Chromium, Firefox and WebKit, because the limitation being
  lifted is one only Firefox had. A live player keeps the caption track the
  author switched on: the `<source>` and `<track>` children are rebuilt only when
  the stored markup actually changes, because a rebuilt `<track>` is a new
  `TextTrack` whose `mode` starts `disabled` -- so resizing a captioned clip used
  to switch its captions back off.

### Fixed

- **One stray `=` in the HTML source box wedged the editor unrecoverably.** The
  HTML parser accepts attribute names `setAttribute` refuses -- `<p ="v">` parses
  to one attribute literally named `="v"` -- and the schema carried those through
  as residue and wrote them back on serialize, so the throw arrived from the
  middle of rendering a document. Closing the source view left the source box
  removed, `sourceMode` reporting false while the Source button still read
  pressed, and the content host still hidden: a blank rectangle with nothing
  clickable, toggling back throwing again, and the author's work gone. Assigning
  such a document to `element.value` threw on assignment and `get value` threw on
  read, so a legacy row or a hand-edited template could not be opened at all.
  Fixed in both halves: the attribute capture now refuses a name that is not an
  XML `Name` -- the spec's rule rather than the host's, because browsers are
  laxer than jsdom and content stored in a browser session would otherwise throw
  on a server -- and the source-view teardown restores the editor in a `finally`,
  so any future failure in applying source HTML leaves a usable editor rather
  than a blank one. A generated round-trip suite now asserts that
  `serializeHtml(parseHtml(x))` never throws.
- **An unclamped `colspan` was a browser-hanging denial of service.** Cell spans
  were read straight off the attribute and never bounded, and both consumers of
  a span scale linearly in it: `TableMap.get` allocates and fills
  `width * height` map cells, and the column-resizing view that `plugins-table`
  installs for every table appends one real `<col>` element per column. So a
  fifty-byte `<td colspan="5000000">` was five million DOM elements built
  synchronously and a table asked to lay out half a billion pixels wide --
  reachable through `element.value`, `parseHtml`, a paste, an import, or content
  stored before the bound existed. Negative values were worse: `|| 1` caught
  `NaN` and `0` and nothing else, so `colspan="-5"` survived and `computeMap`
  walked its write cursor backwards through the map it was filling. `colspan` is
  now clamped to 1-1000 and `rowspan` to 1-65534, which are HTML's own limits, so
  no document a browser would have parsed the same way loses anything.
  `data-colwidth` is bounded in the same pass -- digits only, one entry per
  covered column, and a sane ceiling -- because each entry went into
  `col.style.width` unexamined and `Number.isFinite` accepted negatives.
  A per-cell bound is not enough on its own, so a row also carries a cumulative
  budget of 1000 columns: 5,000 `<td colspan="1000">` cells are about 125 KB of
  input and reached the same five-million-column table by addition instead of by
  one large number. Cells are clamped against what the row has left, and a cell
  arriving with nothing left still claims a single column rather than being
  dropped, since losing a cell would change the document silently. The width a
  table can reach is therefore bounded by the markup that had to be written for
  it rather than amplified by it.
- **`readonly` was not enforced for the table context menu, or the media resize
  handle.** Both are bound to real DOM on the editable surface -- the menu on
  `view.dom`, so cell-selection handling in `prosemirror-tables` cannot swallow
  the event first, and the handle as a button inside a node view -- and that is
  what took them out of ProseMirror's `editable` gate, which is the guard typing,
  paste, drop and the keymaps get for free. A right-click on a read-only table
  opened all fourteen entries live and Delete row worked, from the mouse and from
  Shift+F10; an arrow press on the resize handle stored a new width. Both now
  check `view.editable`, which is the flag ProseMirror itself consults and the
  one upstream's column resizing already checked. The menu is refused at open
  time and re-checked before an item runs, and an open menu is dismissed if
  `readonly` arrives while it is up. The handle reports `aria-disabled` rather
  than silently doing nothing, kept accurate across a `readonly` toggle by
  watching for that transition only -- not per transaction, which would put
  per-node work back on every keystroke. The element's own context menu is
  refused under `readonly` too, on both the pointer and the Shift+F10 route:
  every entry in it is an edit that `invoke` already declined to run, so opening
  it offered a dead list *and* called `preventDefault()`, taking away the
  browser's own copy-and-inspect menu -- which is the whole of what a read-only
  reader wants from a secondary click. And the resize drag is re-checked at the
  commit rather than only at the `pointerdown` that began it, since `readonly`
  can arrive mid-gesture and the start guard has passed by then.
- **Tables no longer discard `<caption>`, `<colgroup>` and `<col>`.** These were
  dropped on parse, so opening and saving a captioned table destroyed its caption
  text permanently. A caption is a table's accessible name, which made this an
  accessibility defect as much as a fidelity one. All three now round-trip
  byte-identically. They render but are not editable in place: a caption has to
  be a child node for that, and `prosemirror-tables` derives its cell map from
  `table.childCount`, so it needs an upstream fix first.
- **Source-only media was destroyed, not merely uneditable.**
  `<video controls><source src="clip.webm"></video>` has no `src` of its own, so
  the schema declined it and the preservation layer's drop rule then deleted the
  element and every address in it. It saved as `<p></p>`. Media carrying fallback
  content -- a download link for browsers that cannot play the file -- is now
  preserved whole rather than having the fallback deleted.
- **A locked region could silently swallow a command.** The transaction filter
  for `contenteditable="false"` read the state's document using coordinates from
  each step's own map, which for any step after the first addresses a different
  document. Once an earlier step grew the document the read ran off the end,
  threw, and ProseMirror dropped the whole transaction. What an author saw was a
  toolbar button doing nothing: inserting a table column after inserting a row
  produced exactly that shape.
- **The character map and emoji pickers were open on page load**, floating over
  the middle of the page and following the scroll. The plugin's own
  `display: grid` is an author declaration and so overrode the user-agent rules
  that keep both `[hidden]` and a closed `[popover]` hidden.
- `@openleaf-editor/sanitize` allows `caption`, `colgroup`, `col`, `source`,
  `track`, cell and row `valign`, `sub`, `sup`, heading `id`, and the modelled
  style properties, so the shared policy no longer strips markup the schema
  preserves. `toDOMPurifyConfig` now withholds `iframe` unless told the embed
  hook is installed: the host allowlist is a per-element check no DOMPurify
  config can express, and listing the element without it let an arbitrary nested
  page through the sanitizer SECURITY.md recommends.

### Changed

- **`<font face="Verdana">` converts to `<span style="font-family:Verdana">`.**
  A legacy tag whose every attribute a mark can hold is now modelled rather than
  preserved, which is what makes the run editable. `<font>` carrying anything a
  single mark cannot hold -- `face` plus `color`, say -- is still preserved whole.
  The same applies to `type="a"` on a list, which becomes `list-style-type`.
- **A modelled style declaration comes back in the schema's canonical spelling
  and order.** Once a property lives in a node attribute the source spelling is
  gone before anything serializes; this has always been true of `text-align` and
  now applies to the typography properties too. Declarations the schema does not
  model still go back verbatim, and the fidelity corpus checks declaration by
  declaration so a re-spelling cannot hide a loss.
- Insert table is a size grid rather than an immediate 3x3 insert. The
  `insertTable(rows, cols)` command is unchanged for programmatic use.
- The core bundle's gzip budget rises from 92 KB to 108 KB across these changes,
  measured at 106.8 KB. Every rise is storage format -- schema, commands,
  preservation, sanitizer vocabulary -- with the editing chrome staying in opt-in
  bundles.
- `pnpm typecheck` works. It runs `tsc -b`, which needs a root `tsconfig.json`
  that did not exist, so it failed with TS5083 before checking anything. It now
  also type checks the tests, which nothing did before.

## 0.1.0-beta.1 - 2026-08-19

First release with the formatting features most CMS integrations expect.

### Added

- Text alignment, modelled in the schema as a `style` attribute with a single
  canonical CSS vocabulary in `packages/core/src/css.ts`, shared by the schema,
  the commands, the preservation layer and the sanitizer.
- Text and highlight colour marks, in `@openleaf-editor/core` rather than in the
  optional picker bundle: without them an inherited `<span style="color:#c00">`
  is claimed by the preservation layer and becomes an uneditable atom.
- `@openleaf-editor/plugins-colour`, the opt-in colour picker UI.
- `registerImageUploader()` in `@openleaf-editor/element`, enabling file
  selection, paste and drag-and-drop image upload against your own endpoint.
  URL-based image insertion continues to work with no uploader registered.

### Changed

- A `<span>` whose only attribute is a style the colour marks fully model now
  unwraps instead of being preserved as an opaque atom, so inherited coloured
  text is editable and still byte-identical on output.

## 0.1.0-beta.0 - 2026-08-19

Initial public release, published to npm under the `@openleaf-editor` scope.

### Added

- `<openleaf-editor>` custom element with `<textarea>` and form binding.
- `@openleaf-editor/core`: schema, commands, HTML I/O, and the content
  preservation layer that keeps unrecognised markup as a movable atom rather
  than discarding it.
- `@openleaf-editor/paste`: Word and Google Docs paste normalisation, including
  nested list reconstruction.
- `@openleaf-editor/ui`: keyboard-accessible toolbar, dialogs, icons, and the
  `midnight`, `paper`, `contrast` and `compact` skins.
- `@openleaf-editor/sanitize`: one canonical allowlist with adapters for
  DOMPurify, Python Bleach and PHP HTMLPurifier.
- Optional plugins: `plugins-table`, `plugins-highlight`, `plugins-import` and
  `plugins-import-docx`.
