# Changelog

All notable changes to OpenLeaf are recorded here.

The repository is a monorepo and every `@openleaf-editor/*` package shares one
version number, so one entry describes the whole release. Keep all packages on
the same version.

This project follows [Semantic Versioning](https://semver.org/). While the
version is `0.x`, minor and pre-release bumps may contain breaking changes; the
entries below say so explicitly when they do.

## Unreleased

### Added

- **`@openleaf-editor/plugins-webmcp`: an opt-in agent tool surface.** An agent
  driving the page can ask which OpenLeaf editors are on it and get back a
  stable identifier for each — the host element's `id`, or an ordinal where it
  has none — and an editor removed from the page stops being offered. The
  registration is page-global and made once, because the browser answers a
  repeated tool name with `InvalidStateError: Duplicate tool name` and a page
  with several editors is the normal case here; each editor adds itself to a
  register through the editor plugin's own per-view lifecycle instead. In a
  browser without the API, installing is silent: no error, no console output,
  and no half-wired editor. The package contributes no nodes, no marks, no
  toolbar items, no icons and no CSS, so a deployment that does not install it
  is unchanged. `#242`
- **`@openleaf-editor/plugins-webmcp`: an agent can ask an editor what it can do
  and read what is in it.** `openleaf_get_capabilities` reports two things
  separately, because they are two different sets: the node and mark types the
  editor's document can store, and the editing commands that editor actually
  offers. The schema is deliberately the wider of the two — table and structural
  nodes are in it whether or not the chrome for them was installed, so that a
  stored document round-trips in every deployment — and the commands are
  narrowed again by the `toolbar` layout the integrator gave that editor, so two
  editors on one page can answer differently. An agent told only the schema
  would attempt edits that cannot happen; one told only the commands would treat
  a stored table as unreadable. `openleaf_get_document` returns the editor's
  current content as HTML, including edits the author has not saved, and is
  annotated `untrustedContentHint` because a document is where text aimed at the
  agent reading it hides. Both are annotated read-only, and naming an editor
  that is not on the page answers with a failure that says to list again rather
  than with somebody else's document. `#243`
- **`openleaf_find_text`: an agent can search an editor and get a handle for
  every match.** A handle is how a later call names the same text, because a
  selection does not survive the round trip out to an agent and back. Each
  editor carries its handles through every transaction's position mapping, so
  one taken before an edit elsewhere in the document still names the text it was
  taken for — and one whose text has been deleted fails with `stale-handle`
  rather than sliding onto the neighbouring position, which is how a stale
  handle would otherwise become a write into something nobody chose. Handles are
  opaque, so nothing an agent reads out of one can be computed with, and they
  stop resolving when their editor leaves the page. Text that does not occur is
  an empty result rather than an error. `#244`
- **`openleaf_apply_command`: an agent can format a passage using the editor's
  own commands.** Bold, italic or a list, applied to the text a handle names,
  and applied by running the command the toolbar button runs rather than by
  writing markup — so an agent inherits every guard a keyboard shortcut already
  has, including ones a plugin added. Only commands that editor actually offers
  can be applied, which is the same intersection of the registry and the
  `toolbar` layout that `openleaf_get_capabilities` reports; a control that only
  works through a dialog says so rather than pretending; and a command that does
  not apply where the handle points reports the refusal rather than reporting
  success. Preserved markup, a readonly editor and an editor whose author has
  the HTML source view open are all refused, matching what the editor's own
  toolbar does. Each call is exactly one transaction, marked as
  agent-originated, so one undo reverses one agent action. `#248`

### Fixed

- **Font-family names with apostrophes, plus signs, or a leading digit now
  round-trip.** `oneFontFamily` only allowed `[a-zA-Z0-9 -]` starting with a
  letter, so `Goudy's Old Style`, `21st Century` and `C++ Sans` were dropped
  at the policy layer, the span was not modelled as a mark, and the toolbar
  showed Default over text that was visibly in that face. The allowlist now
  admits apostrophes, plus and a leading digit; names that are not a single
  CSS identifier are re-emitted in double quotes so a stored single-quoted
  family matches the dropdown. `url()`, `expression()`, `var()`, comments,
  unbalanced quotes, backslash, `;` and newlines are still refused. `#202`

- **A whole-number size claim is checked with the same zlib-survival
  tolerance as a decimal one.** The demo badge `123 KB gzipped` took an
  exact-round path that the 1% band never reached, so CI's Node 22 at
  123.6 KB failed a claim that a Node 26 workstation at 123.25 KB accepted
  -- and writing 124 inverted which machine was red. The `BUDGETS_KB`
  ceilings remain the regression gate.

- **Merging or splitting table cells keeps `colwidth` and `scope` in step.**
  Stock `mergeCells` grew `colwidth` with zeros for the newly covered columns,
  so the colgroup sync then blanked those `<col>`s and the next resize fought
  the stored widths. The surviving cell now holds one width per column it
  covers — concatenated from the cells, or from the colgroup when a column
  never had a cell width — and a split writes those entries back. A header
  that now spans two columns is `scope="colgroup"`; a body cell that still
  carried `scope` from an earlier header conversion has it cleared. `#189`
- **Inserting a table row or column copies the neighbour cell's alignment and
  background.** Stock `addRow` / `addColumn` copied only the cell type, so a
  new row under a right-aligned red cell was unstyled. The new cells inherit
  `align`, `valign`, `style`, and `bgcolor`. They do not inherit `class` or
  `scope`; a new column does not inherit `colwidth`; a body row inserted below
  a header does not inherit the header's chrome. `#189`
- **Autolink is the same undo step as the Space, Enter, or IME commit that
  created it.** The mark used to be a separate transaction (`AddMarkStep` maps
  no positions, so history treated it as a new group): Ctrl+Z after a composed
  URL plus Space peeled the link off, then the space, then the URL. The mark
  now appends to the committing transaction. Paste of a URL-plus-space and
  inserting a table over a selection were already one undo each and are
  unchanged. `#182`

### Added

- **`placeholder` on `<openleaf-editor>`.** An empty document shows the prompt
  as a CSS `::before` on the canvas, never as a text node, so it cannot
  serialize into `value` or submit with the form. ProseMirror's empty
  document is a paragraph containing a trailing break, not an empty
  element; the class `ol-placeholder` is what actually gates the prompt.
  `#175`
- **Pasting a bare image URL inserts an `<img>`.** A clipboard whose entire
  plain text is one `http(s)` URL whose path ends in `png`, `jpg`/`jpeg`/`jfif`,
  `gif`, `webp`, or `avif` goes through `isSafeUrl` and `insertImage`, with
  or without an uploader. Query strings and fragments are ignored when
  looking at the path. An extensionless CDN address, an SVG, or any other
  non-image URL keeps today's link/plain paste. `#168`
- **`openleaf:link`.** A read-only editor never follows an `<a href>`
  (mouse, keyboard, or modified click). It fires a bubbling, composed,
  non-cancelable `openleaf:link` with `{ href }` set to the authored
  attribute. Integrators who want a new tab listen and call
  `window.open`. `#181`

### Fixed

- **Read-only left-click no longer navigates away.** `contenteditable="false"`
  restores native link activation; the canvas now `preventDefault`s it
  without making the anchor inert, so Tab and the browser's own menu can
  still copy the URL. There is no `querySelector(href)` path in the
  repository; the handler uses `closest('a')`, so an href containing
  `;`, `:`, `[` or `.` cannot throw. `#181`
- **`autoresize` no longer writes a pixel height.** The old `height: auto`
  → `scrollHeight` → pixel write was a synchronous reflow, and a no-op
  observer pass left the canvas at `height: auto` for a frame. The
  canvas now sizes to its content; leftover inline heights are cleared.
  `#180`
- **Canvas `lang` and `spellcheck`.** Host `lang` is copied onto the
  editable region (UI locale doubles as the spellcheck language). A bound
  textarea's `lang` is used when the host has none. Page `<html lang>`
  is left to inherit. `spellcheck="false"` on the host is copied onto
  the region, matching the off switch source view already has. `#175`

- **The editor context menu survives the pointer sequence that opened it.**
  Hybrid and long-press engines fire `contextmenu` and then a follow-up
  `pointerdown` for the same `pointerId`; the document capture closer treated
  that down as an outside click, so the menu flashed and vanished -- and
  `preventDefault` had already eaten the browser's own menu. The closer now
  ignores the ids that were in flight when the menu opened, until each is
  released. A later, different pointer still dismisses. Keyboard open
  (Shift+F10 / Menu) is unchanged. `#199`
- **A pointer context menu at `clientX === 0` stays at the click.**
  `#showContext` treated `x <= 0` as a synthesized keyboard event and moved
  the menu to the caret. Keyboard already passes `point === null`; a real
  click on the left edge (or any event whose `clientX` is 0) now uses the
  event coordinates, which the menu already clamps onto the viewport.
  Negative `clientX` is treated the same way -- a real coordinate, not a
  missing one. `#200`
### Changed

- **The main toolbar stays on screen while the editor is in view.** `.ol-toolbar`
  is `position: sticky` against the nearest scrolling ancestor — page scroll in
  the framed and autoresize cases, which is what used to take Bold/Link/Save
  off-screen on a long canvas. Fullscreen is unchanged: the host is a column
  flex and only the content pane scrolls, so the bar never left. Integrators
  with a fixed site header set `--openleaf-toolbar-sticky-offset` (default
  `0px`). The menubar and a second toolbar stay in flow: two sticky bars at
  the same `top` would overlap, and stacking them needs a height the
  stylesheet cannot know. `toolbar2` is marked `.ol-toolbar--secondary` so
  that holds when it is the only bar (`toolbar="none"`). Floating bars stay
  `position: absolute`. The overflow
  More panel is already `position: fixed` from the trigger's viewport box, so
  it still tracks the button when the bar is stuck. `#203`

### Fixed

- **Underline and strikethrough follow the text colour**, including on a dark
  skin and when a colour mark is nested inside `<u>`/`<s>` (the order the
  schema serializes). CSS Text Decorations paint the line in the originating
  element's colour, so `text-decoration-color: currentColor` on `u`/`s` is a
  no-op for that nest; the colour span re-establishes the line in the glyphs'
  colour. Highlight is background only — the line still matches the
  foreground. Stored HTML is unchanged. `#190`
- **Floating selection and insert bars hide when the editor is unfocused,
  readonly, or the selection sits inside a locked node.** Visibility was
  selection-shape only, so a click on the host page left the selection bar
  painted, a readonly empty editor showed the insert bar on mount, and a range
  inside `contenteditable="false"` (or a preserved atom) still offered Bold.
  Pointer-down inside the canvas still counts as focused: some engines have
  not moved focus into the view yet while a drag-select is establishing the
  range, and a naive `hasFocus()` guard would hide the bar for that gesture.
  A Select All (or a drag that merely *contains* a locked block) still shows
  the bar: the unlocked text is formattable, and the transaction filter
  already refuses the locked interior. `#186`

### Changed

- **Help and the shortcut docs now tell the truth about Tab in a code block.**
  Tab is still unbound (WCAG 2.1.2): it leaves the editor, including from a
  `<pre>`. Indentation in a code sample is typed spaces. `Mod-]` remains
  paragraph and list indent — it does not insert spaces into the `<pre>`,
  but it still nests a list item when the caret is inside one. The F1 dialog
  lists Tab as "leave the editor" rather than implying it moves to the
  toolbar (that is Alt+F10), and does not claim the chord is a no-op in
  code. `#208`

- **Excel clipboard HTML is no longer classified as Word.** `detectSource` now
  returns `'excel'` for an Excel envelope (`ProgId=Excel.Sheet`, the Excel
  xmlns, `x:num` / `x:str` / `x:fmla` cell attributes) and routes it through
  its own normalizer, which does not run Word's list reconstruction. A Word
  document that embeds a spreadsheet still takes the Word path; Google Sheets
  still takes the gdocs path. Adding `'excel'` to `PasteSource` is a breaking
  change for consumers who exhaustively switch on that union. `#177`

- **Replace all returns focus to the find field.** The click handler never
  moved focus, and after a successful replace the button disables, which
  dumps focus to `<body>` in every engine. Focus now goes back through the
  same path `open()` uses, before the replace runs, so the "{n} replaced"
  live-region announcement is not interrupted by a later focus move. `#204`
- **Word count and find skip the same invisible format characters.**
  Zero-width space, soft hyphen, and BOM inflated `characters` (and ZWSP
  split words), while BOM was `\s` and dropped from
  `charactersExcludingSpaces` only. Both totals, the word count, and the
  find index now omit U+200B, U+00AD, and U+FEFF. Find treats them as a
  match barrier so Replace cannot swallow them. Non-breaking spaces are
  unchanged. `#191`

- **The media resize handle is withheld until the image has decoded or the
  video has metadata**, and a drag or arrow key during that window does not
  write a width. The handle used to sit on the broken-image box (or a 0×0
  frame) and the first drag stored that placeholder's ~16–40px width, which
  then survived once the real bitmap arrived. A stored numeric width is still
  enough to offer the handle: height stays unset until the ratio is known,
  matching the existing video path. A cached image that is already `complete`
  is checked synchronously, so a listener-only wait cannot miss it. `#188`

- **Pasting a table into a cell nests it instead of rewriting the host grid.**
  `tableEditing.handlePaste` unwrapped any slice whose outer node was a table
  and ran `insertCells` from the caret, so a 2×2 pasted into a 2×2 replaced the
  host and a slice of loose cells rewrote `colspan` on cells the author had not
  selected. A whole table, or loose cells, pasted at a text caret now become a
  nested table; a cell selection still maps onto the selected rectangle. A whole
  table keeps its caption, colgroup, header/footer counts and other table
  attributes — including when the slice is open by one, which is how a copy of
  every cell arrives. `#176`
- **Column resize over a nested table grabs the table whose border the pointer
  is on.** `columnResizing` hit-tests the innermost `td`, so a pointer on an
  outer column edge that crossed a nested table resized the inner grid and left
  no way to restore parent widths. A wrapping plugin prefers the outer border
  when the pointer is on it; an inner border that is not also an outer one still
  resizes the nested table. `#176`

- **Preview and print now match the canvas.** Session Preview and Print built a
  hardcoded light document (`system-ui`, invented table borders, no `dir`) and
  ignored the editor's `content-css`, the active skin, and the host direction, so
  a published stylesheet or an RTL canvas never reached either surface. Preview
  now loads those `content-css` URLs unscoped (the iframe is not under the
  canvas scope root), copies `dir` / `lang` and the skin's tokens onto the
  preview root, and leaves per-block `dir` intact. Print does the same except a
  dark skin is not printed as a dark page. `#172`
## 0.1.0-beta.4 - 2026-08-24

### Fixed

- **An open More panel survives a toolbar layout.** Measuring the bar means
  putting every group back into it, so a `ResizeObserver` pass that arrived
  just after the author opened the panel closed it again and dropped the focus
  inside it. A layout is now deferred while the panel is open and runs when it
  closes; a viewport resize still closes the panel first, so that case reflows
  immediately.
- **The demo's narrow-toolbar sample really does overflow.** At `20rem` that bar
  fitted -- the block-type select shrinks to absorb the difference -- so the
  section documenting the More menu showed none, and its tests passed only
  because a `hidden` button still painted. It is `15rem` now.
- **A hidden `.ol-btn` is really hidden.** `.ol-editor .ol-btn`'s
  `display: inline-flex` outranks the user agent's `[hidden]` rule on
  specificity, so a bar wide enough to need no overflow set `hidden` on its More
  trigger and painted it anyway -- and pressing it opened an empty panel. This
  is the same trap already fixed for the floating bar and the panel itself.
- **The toolbar's More button keeps focus when the bar lays itself out.** Every
  overflow layout re-appended the trigger, and re-inserting an already-connected
  node drops focus to the document in every engine -- so a `ResizeObserver` pass
  landing while a keyboard user stood on More (a font finishing, a density
  change, a CMS sidebar animating open) sent their next Enter to the page
  instead of opening the panel. A layout that changes nothing now moves nothing,
  and one that does move controls puts focus back -- on the trigger, if the
  control it was on went into the panel. This reached CI as a WebKit-only flake;
  the cause was never WebKit-specific.
- **Align left/centre/right now applies to a selected image or figure.** The
  toolbar only walked textblocks that declare `align`, so a clicked picture
  either did nothing (a figure has no such attribute) or centred its parent
  paragraph instead of writing `image.attrs.align`. A NodeSelection on the
  image or the figure wrapping it stores `left` / `right` / `center` on the
  image -- the same values the dialog already wrote, serialized as
  `ol-float-left` / `ol-float-right` / `ol-align-center`. Mixed text and
  image ranges still align both; a click on the picture does not also
  `text-align` the paragraph around it. `#183`
- **Dropped or pasted image files with an empty MIME type, or a `.jfif` name, now reach the uploader.** `isUploadableImage` used to look only at `file.type`, so iOS and some file managers handing over `type === ""` with a name like `IMG_1234.PNG` never opened the dialog, and the drop fell through to the browser. `.jfif` is treated as JPEG. **HEIC/HEIF is refused with a live-region message**, not converted and not passed through: OpenLeaf has no decoder and no server. A mixed PNG + HEIC drop still uploads the PNG. `#170`
- **Enter on an empty list item that still holds extra blocks now leaves the
  list.** Stock `splitListItem` only lifted when the empty paragraph was the
  last child, so a callout or nested list after it stuck the author in the
  item -- Enter created another `<li>` instead of promoting those children to
  siblings of the list. The empty paragraph is dropped so a save does not
  store `<p></p>` next to a callout. Non-empty Enter is unchanged: following
  blocks still travel with the new item. `#178`
- **Dragging a captioned image moves the whole figure, not just the `<img>`.** A
  bare image already moved; dragging the photo inside a `<figure>` ripped it
  out of the caption and left an illegal `<figure><figcaption>` behind. The
  figure and caption now move (or copy, with Alt/Ctrl) as one history step.
  `#185`
- **Find treats a non-breaking space as a space.** A query typed as
  `hello world` missed Word-pasted `hello\u00a0world` because the search
  index only case-folded. Both the document and the query now fold U+00A0
  to U+0020, so the two spellings find each other. Other Unicode spaces
  are left alone. Replace writes whatever was typed, which converts those
  NBSPs when the replacement uses ordinary spaces. `#205`
- **The character map and emoji grid now mount on the editor host, not
  `document.body`.** A body-mounted popover left the shadow tree of any CMS
  that nests `<openleaf-editor>` in a web component, so `document.activeElement`
  was the host and a 0ms `focusout` timeout closed the panel the moment it
  opened -- and IME composition never saw `compositionend`. The colour picker
  already appended to the host for this reason; the glyph pickers follow it,
  and `focusout` now trusts `relatedTarget` rather than `activeElement`. `#173`
- **Autolink now commits a typed URL when an IME composition ends**, not only
  after a physical Space or Enter. CJK and mobile keyboards that accept a
  candidate without inserting ASCII whitespace used to leave `https://…` as
  plain text. The mark is applied on `compositionend` after ProseMirror
  flushes, and never while `view.composing` is still true -- including the
  space path, which reaches the plugin as a transaction rather than through
  `handleTextInput` and so was not covered by that guard. A composing IME
  dispatches a transaction per composition update via `readDOMChange`, so a
  buffer holding a space after a URL could take an `addMark` under the open
  IME. `#165`
- **Find, Replace All, and the word count skip `contenteditable="false"`
  regions.** Hits inside a lock were indexed and counted, so Replace All of a
  word that also appeared in body copy wrote those ranges into one transaction
  and `nonEditablePlugin` rejected the whole thing -- including the unlocked
  matches. The search index and the count walk now omit locked subtrees. `#169`
- **Dropping or pasting an image no longer inserts (or throws) after the
  editor has been torn down.** `#uploadImages` awaited the describe-and-upload
  dialog, then called `insertImage` and `view.focus()` on the `EditorView`
  captured at drop time. A navigation or custom-element unmount during the
  dialog left a destroyed view; import already refused that, the image path
  did not. `#171`
- **A document that is only a page-break, video, or `<details>` can take a
  caret on either side, and typing no longer replaces the atom.** The editor
  never installed a gap cursor, so ArrowLeft on a selected page-break stayed a
  node selection and the next keystroke deleted it. `gapCursorPlugin()` is now
  installed next to the isolating-selection clamp. Tab is still unbound.
  `#164`
- **Typing over a selection that crosses into `<details>` no longer empties
  the summary or lifts the body out of the element.** `handleTextInput` only
  runs when ProseMirror already believes the selection is a range; on a subset
  of Shift+ArrowDown runs the model caret was still collapsed, so Chromium
  applied the keystroke to the DOM range and the isolating clamp never saw it.
  The plugin now handles `beforeinput` from the live DOM selection and applies
  the clamped edit itself. Undo restores the pre-keystroke document. `#163`

## 0.1.0-beta.3 - 2026-08-23

### Fixed

- **Tab now leaves the emoji and character-map pickers in Firefox, which used to
  trap the keyboard inside them.** Firefox moved focus nowhere at all from the
  grid's single tab stop, so the panel stayed open with focus stuck on the first
  glyph and Escape was the only way out -- a WCAG 2.1.2 (No Keyboard Trap)
  failure. The grid handles Tab itself now: it closes, returns focus to the
  trigger, and leaves the key undefaulted so the browser's own Tab carries on
  from there. All three engines land on the editor, where Chromium previously
  dropped focus into the browser chrome. Shift+Tab goes backwards for free.
- **A styled span that also carries a class, `id`, `data-*`, or an unmodelled
  declaration is no longer wrapped in a second colour/font span on the first
  save.** `text_color`, `font_family` and `font_size` now decline when
  preservation is going to keep the element, the same bargain `background_color`
  already struck. `#127`
- **Inserting or deleting a table column keeps a stored `<colgroup>` in step
  with the cells.** Widths and classes that lived only on inherited `<col>`
  elements used to describe the previous columns after a column command.
- **A formats-dropdown entry whose token names both an element and a class is
  available over a block that already is that element.** `p.lead=Lead` went
  disabled the moment the caret sat in a paragraph -- the one place an author
  reaches for it -- because availability was decided by the element half alone
  and `setParagraph` declines a paragraph. Either half having work to do is now
  enough. A class-free entry such as `h2` stays disabled where its own command
  is, so the figure-caption guard is unchanged.
- **The core editor marks a table caption `contenteditable="false"` so a caret
  cannot enter furniture ProseMirror does not own.** `tableCaptionPlugin` sits
  ahead of the table-editing bundle so column resize still supplies the live
  table node view. Stored HTML is unchanged.
- **Serialized images put `class` before `src`**, matching the stored spelling
  the round-trip fixtures pin rather than engine insertion order.
- **Isolating-selection tests follow sole-paragraph unwrap** on a details body
  and in a blockquote: the body stays inside `<details>` after a crossing edit,
  and undo restores `<blockquote>quote</blockquote>`, without either assertion
  requiring a wrapper `<p>` that save would strip.
- **The `.docx` zip-bomb guard no longer hangs forever on Node 22.**
  `inflateRawLength` handed `DecompressionStream`'s writer the bare
  `ArrayBuffer` rather than a view over it. Both satisfy `BufferSource`, and the
  newest V8 tolerates the buffer, but Node 22 -- which is what CI runs -- accepts
  the write, emits no output, and never closes the readable, so the first
  `reader.read()` waits forever. `assertImportableDocx` runs on every imported
  `.docx`, so an import hung with nothing to report rather than succeeding or
  failing. Ten tests timed out on every push because of it.
- **A documented bundle-size claim is checked against a tolerance that survives
  a different zlib.** `gzipSync` output length is not reproducible across zlib
  builds -- CI's Node 22 weighs the docx bundle at 125.4 KB where a Node 26
  workstation weighs the same bytes at 124.5 KB -- so the ~100-byte tolerance
  meant the claim written on one machine could not pass on the other, and the
  documentation step failed on a mismatch no edit could fix. Now a percent of
  the measurement. The exact ceilings in `BUDGETS_KB` are still what stop a real
  size regression.
- **The glyph-picker Tab test no longer races the close it provokes.** Tab
  moves focus out of the grid and `focusout` then closes the panel by design, so
  the cell leaves the accessibility tree; the assertion was a role query and
  reported "element(s) not found" whenever the close landed first. It locates
  the cell by attribute now, the way the grid locators in that file already do.

### Security

- **`.docx` zip-bomb guard fails closed on forged ZIP64 sentinels.** Writing
  `0xffff` into the EOCD entry count, or `0xffffffff` into the directory offset,
  used to make `declaredUncompressedBytes` return `null`, which
  `assertImportableDocx` treated as allowed. Those sentinels are now honoured
  only when a ZIP64 EOCD locator sits immediately before the EOCD, an unreadable
  directory is refused, inflated bytes are bounded independently of what the
  archive declares, and local records that are not packed immediately before the
  central directory are refused so a partial inflate walk cannot undercount.

### Fixed

- **Selecting an image and opening the Image dialog no longer wipes alt text,
  caption, size, alignment, or class.** The same toolbar and context-menu item
  now prefills from the selected image (including a figure's caption) and
  updates that node in place, so alt text is editable after insert. The control
  reads "Edit image" while an image is selected.
- **Preserved block elements inside a blockquote or list item no longer grow
  two empty paragraphs on every save.** `unknownInline` declined only
  lossless wrappers, so a `<div class="callout">` (or any other tag the HTML
  parser closes a `<p>` for) became an inline atom, serialized inside a
  paragraph, and split on the next parse. The catch-all now consults a shared
  `CLOSES_OPEN_P` list and leaves those tags to `unknownBlock`. Custom
  elements and genuine inline debris (`<ins>`, `<o:p>`) are unchanged. A
  second serialize is a fixed point.
- **A `<figcaption>` outside a `<figure>` no longer grows the document by two
  empty paragraphs on every save.** The caption node is inline (because a
  modelled figure holds inline content), and the HTML parser closes an open
  `<p>` at `figcaption`, so wrapping an orphan in a paragraph made the next
  parse insert empty paragraphs with no fixed point. The parse rule now only
  matches inside a figure; an orphan in a paragraph is preserved as a block
  atom and round-trips without wrapping. A caption already inside an
  inline-only container such as `summary` stays inline so the details block
  is not escaped. Nested figures are unchanged.
- **A selection spanning a `<blockquote>` into a following `<details>` no longer
  throws on the next keystroke, corrupts the document, or loses undo.** Firefox
  and WebKit report a `TextSelection` whose endpoints sit on opposite sides of
  an isolating boundary; `replaceSelection` then tries to join `details` onto
  `blockquote` and throws. Core now clamps that selection to the anchor's side
  (the same thing Chromium already does natively) for every isolating node, and
  refuses to run a replace that would throw, so a failure cannot rewrite the
  document outside history.
- **`<a id>` wrapping visible text no longer deletes that text.** `named_anchor`
  is an empty atom (TinyMCE-style jump targets). Its parse rule claimed any
  `<a>` with `id` and no `href`, so `<h2><a id="sec">Title</a></h2>` serialized
  as an empty heading. Contentful `<a id>` is now a `link` mark carrying only
  `id`; empty and whitespace-only `<a id="jump"></a>` is still the atom;
  `<a id href>` is still a link;   `<a name>` is still unmatched.

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

### Fixed

- **Character marks keep leftover attributes on round trip.** `strong`, `em`,
  `code`, `u`, `s`, `sub`, `sup`, `b` (as `strong`) and extra attributes on
  `<a>` (`class`, `data-*`, …) used to be stripped because the carry wrapper
  ran on nodes only. The same sanitizer filter still drops `on*` handlers and
  unsafe URLs. Closes #126.
- **Table captions no longer leak `contenteditable="false"` into clipboard
  or saved HTML.** The editor still stamps that marker on the live caption so
  a caret cannot enter it (`CaptionedTableView` when the table bundle is
  loaded, `tableCaptionNodeView` when it is not). Serializers share `toDOM`
  and never run node views, so the marker is not emitted; parse also drops
  it from the caption element itself if contaminated markup is opened.
  Core no longer installs a competing `table` node view, which would have
  shadowed column resizing.
- **`t()` no longer returns `Object.prototype` members as translations.** Catalog
  lookup is a Map, so a `formats="p.lead=constructor"` label (or `toString`,
  `__proto__`, …) stays the source string instead of rendering
  `function Object() { [native code] }` in the dropdown the moment a locale
  catalog is registered. `{placeholder}` substitution uses `Object.hasOwn`, so
  `{constructor}` in a template is the same class of miss.
- **`clearFormatting` keeps per-run language marks.** Links and `dir` already
  survived because they are content, not appearance; `lang` is the same fact
  modelled as a mark, so stripping it silently broke WCAG 3.1.2 and lost
  pronunciation, hyphenation, and `:lang()` for that phrase.
- **`safeClassList` no longer silently deletes Tailwind, non-ASCII, or
  leading-digit class tokens.** It used an ASCII-identifier regex, so
  `md:w-1/2`, `p-[10px]`, `2col`, and `größe-mittel` were dropped whenever
  another token survived beside them. An image with only `class="md:w-1/2"`
  kept it as residue; the same class next to `rounded` or `ol-float-left`
  was gone. Class tokens now follow the same rule as `id`: a non-empty run
  of non-whitespace. Deduplication, alignment-class exclusion, and the
  empty-list `null` contract are unchanged. Which classes a deployment
  stores remains a sanitize policy, not a schema filter.
- **Editing a link through the dialog no longer deletes `rel` or `id`.** Issue
  #14 restored `target`; Save still synthesized `rel` from the new-window
  checkbox and wrote `id: null`. Author tokens (`nofollow`, `sponsored`, `me`,
  …) are kept, `noopener noreferrer` is merged in for `_blank` rather than
  replacing the attribute, and `id` round-trips. The same `run` handler backs
  the toolbar, context menu, and selection toolbar.
- **`resolveLanguage` no longer returns `Object.prototype` members.** The alias
  table was a plain object, so `<code class="language-constructor">` resolved to
  the `Object` constructor: `canHighlight` reported true (`undefined !== null`)
  and `tokenize` fell out of its switch and returned `undefined` instead of the
  `null` the highlighter contract uses for an unknown language. The table is a
  `Map` now, matching `LIST_STYLE_ALIASES`, and `tokenize` has a `default` that
  returns `null`.

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

- **Block-type commands no longer destroy a captioned `<figure>`.** `figure` is a
  textblock (`content: 'inline+'`), so `setHeading` and `setParagraph` used to
  retype it as an `<h2>`/`<p>` holding an image and a `<figcaption>`,
  `toggleCodeBlock` threw `Invalid content for node figure`, and
  `insertHorizontalRule` split the figure in two. Those commands now refuse a
  textblock the destination cannot hold, `canInsert` stops at isolating nodes,
  and the block-type dropdown disables Heading and Paragraph while the caret is
  in a caption.
- **A read-only editor was mutated by clicking a `<summary>`.**
  `disclosurePlugin` toggles `<details>` through `handleDOMEvents.click`, which
  ProseMirror runs before its `view.editable` gate -- the guard typing, paste,
  drop and the keymaps get for free. The handler wrote `open` on the node, so
  `.value` changed and `openleaf:change` fired on a document the host had marked
  read-only; a host that autosaves on that event, or `FormBridge.sync()` at
  submit, persisted the fold. The click now returns without a transaction when
  `!view.editable`, same flag the table context menu and the media resize handle
  already consult, and does not `preventDefault`, so the browser can still expand
  a collapsed section on a non-contenteditable surface without writing the node.
- **Only the first glyph in the character map and emoji picker was reachable
  from the keyboard.** The panel intercepted Tab (and closed) and had no arrow
  keys, so 1 of 40 characters and 1 of 32 emoji could be chosen without a
  mouse. It also used `role="menu"` with plain button children, which is
  invalid ARIA -- a reader announced a menu with no items. Both pickers now
  use the colour picker's grid: `role="grid"` / `row` / `gridcell`, a roving
  tabindex, and Arrow / Home / End navigation. Tab is left alone so it leaves
  the widget.
- **Autolink marks the URL, not the punctuation after it.** The href already
  dropped trailing `.,;:!?`, but the mark still covered the full match, `]`
  survived into the href, and a parenthesised `www.` URL never matched. One
  strip — including unmatched `)` / `]` — now sets both the range and the href;
  a balanced `Foo_(bar)` keeps its closing paren.
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
