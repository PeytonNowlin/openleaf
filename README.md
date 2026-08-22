<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/openleaf-logo-dark.png">
    <img src="assets/openleaf-logo.png" alt="OpenLeaf" width="420">
  </picture>
</p>

<p align="center">
  A framework-agnostic rich text editor for the web.<br>
  HTML in, HTML out, with no paid tier, license key, telemetry, or cloud dependency.
</p>

<p align="center">
  <a href="https://peytonnowlin.github.io/openleaf/">Live demo</a> ·
  <a href="https://www.npmjs.com/package/@openleaf-editor/element">npm</a> ·
  <a href="CONTRIBUTING.md">Contributing</a> ·
  <a href="SECURITY.md">Security</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@openleaf-editor/element"><img alt="npm version" src="https://img.shields.io/npm/v/@openleaf-editor/element?tag=beta&label=npm&color=2f7d32"></a>
  <a href="LICENSE"><img alt="Apache 2.0 license" src="https://img.shields.io/badge/license-Apache--2.0-blue"></a>
  <img alt="Node.js 20 or newer" src="https://img.shields.io/badge/node-%3E%3D20-43853d">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178c6">
</p>

> [!WARNING]
> OpenLeaf is currently in beta. Its APIs may change, it has not yet been proven
> in production, and it has not completed testing with real screen readers. Review
> the [known limitations](#project-status) before using it in production.

## Why OpenLeaf?

OpenLeaf is a drop-in editor for CMS forms, built on
[ProseMirror](https://prosemirror.net/). It stores ordinary HTML and keeps a
bound `<textarea>` synchronized, so existing server-side form handling can stay
in place.

Its defining goal is content fidelity. Schema-based editors can silently discard
markup they do not recognize. OpenLeaf instead preserves unknown markup as a
selectable, movable atom that round-trips without modification. Stored content
and pasted content use separate pipelines: existing documents favor lossless
preservation, while Word and Google Docs paste is normalized into clean,
semantic HTML.

### Highlights

- Framework-free `<openleaf-editor>` custom element
- Ordinary HTML input and output—no proprietary document format
- Content preservation for legacy and application-specific markup
- Word and Google Docs paste cleanup, including nested list reconstruction from
  Word's flat, style-encoded list paragraphs (Google's clipboard HTML already
  carries real `<ul>`/`<ol>` nesting and needs none)
- Configurable, themeable toolbar. The buttons are one tab stop with a roving
  tabindex; the preset `<select>` controls (block type, font, size, line height)
  are each their own tab stop, and image resize is pointer-only today
- Alignment, fonts, sizes, line height, indent, links, images, lists, block
  quotes, code blocks, and source view
- Typography in the storage format: fonts, sizes, line height, indent, direction,
  language, sub/superscript, and list styles (toolbar covers fonts, size, line
  height, and indent; see below for the rest)
- Optional tables, color controls, syntax highlighting, file import, insert tools,
  and session tools
- React and Vue wrappers around the same custom element; Angular consumes it
  directly, with `CUSTOM_ELEMENTS_SCHEMA` (see below)
- Shared sanitization policy for browser, Node.js, Python, and PHP integrations.
  `sanitizeHtml` needs a DOM: in Node, pass `{ document }` (from jsdom or
  similar). The Python and PHP adapters emit configuration *source text*, so
  regenerating it after a policy upgrade needs Node in the build
- Strict TypeScript, with unit, round-trip fidelity and cross-browser suites
  over the editor and its plugins, and over the `react` and `vue` wrappers
- Apache-2.0 licensed with no feature-gated commercial edition

## Quick start

### Installing with a coding agent

Give the agent the canonical [OpenLeaf integration guide](docs/integrating-openleaf.md).
It includes a framework decision table, package and plugin rules, server-side
sanitization requirements, working examples, and a verification checklist. A
copyable request is:

> Integrate OpenLeaf into this application. First read
> https://raw.githubusercontent.com/PeytonNowlin/openleaf/main/docs/integrating-openleaf.md,
> inspect the existing stack and conventions, choose the matching integration,
> preserve the current package manager and form or state architecture, and run
> the application's relevant checks when finished.

The published demo also exposes [`/llms.txt`](https://peytonnowlin.github.io/openleaf/llms.txt)
as a concise, machine-readable index of the authoritative documentation.

### Install manually

Install the custom element from the beta release channel:

```bash
npm install @openleaf-editor/element@beta
```

Register it once in your application:

```ts
import '@openleaf-editor/element'
```

Then bind the editor to a textarea in an ordinary form:

```html
<form method="post">
  <label for="body">Post body</label>
  <openleaf-editor for="body" aria-label="Post body"></openleaf-editor>
  <textarea id="body" name="body" hidden></textarea>
  <button type="submit">Save</button>
</form>
```

The textarea is updated shortly after document changes and synchronously before
form submission. Set its initial value to load existing HTML. When rendering
stored HTML inside a textarea from a server template, escape it for the textarea
context. Listen to `openleaf:change` and read `event.detail.value` when code
needs the current HTML immediately.

> [!IMPORTANT]
> Editor output is untrusted input. Always sanitize submitted HTML on the server;
> see [Security](#security).

### Configure the toolbar

Choose the controls and their order with the `toolbar` attribute. Use `|` for a
separator or `none` to hide the toolbar.

```html
<openleaf-editor
  for="comment"
  aria-label="Comment"
  toolbar="bold italic | link | undo redo"
></openleaf-editor>
```

Appearance can be selected without rebuilding the editor or losing undo history:

```html
<openleaf-editor for="body" skin="midnight" theme="dark"></openleaf-editor>
```

Built-in skins are `midnight`, `paper`, `contrast`, and `compact`. The `theme`
attribute accepts `light`, `dark`, or `auto`.

### Typography

Font family and size, line height, first-line indent, text direction, per-run
language, subscript and superscript, and list styles are in the schema. That is
what keeps inherited markup editable: without them a stored
`<span style="font-family:Georgia">` or `<font face="Verdana">` is claimed by the
preservation layer and becomes an atom you can move but not edit.

The default toolbar includes font family, font size, line height, indent and
outdent (`fontFamily`, `fontSize`, `lineHeight`, `indent`, `outdent`). Indent and
outdent also sit in the Format menu and keep their keyboard shortcuts.

| Feature | How to reach it |
| --- | --- |
| Font family, font size, line height | Default toolbar selects |
| Indent / outdent | Default toolbar, Format menu, `Mod+]` / `Mod+[`, F1 list |
| Subscript / superscript | `Mod+=` / `Mod+Shift+=`, and the F1 shortcut list |
| Direction, language | `setDir`, `toggleDir`, `setLanguage` |
| List style | `setListStyle` |
| Strip appearance | `clearFormatting` (keeps links, `dir`, and `lang`) |

The commands are exported from `@openleaf-editor/core` and take the same
`(state, dispatch, view)` shape as every other command, so wiring your own
control is `registerToolbarItem` plus one of them. `registerToolbarItem` is
re-exported from `@openleaf-editor/element`, so it needs no extra install — and
on a plain `<script>` integration it is on `window.OpenLeaf`. It originates in
`@openleaf-editor/ui`, if you would rather depend on that directly.
`FONT_FAMILIES`,
`FONT_SIZE_PRESETS`, `LINE_HEIGHT_PRESETS` and `LIST_STYLES` are exported as
sensible defaults for a picker, and `activeFontFamily`, `activeFontSize`,
`activeLineHeight`, `activeIndent`, `activeDir`, `activeLanguage` and
`activeListStyle` report the current value for one.

### Editor chrome

The canvas is not an iframe. Host typography already applies, and extra published
styles can be loaded with `content-css`. Chrome around the canvas is optional
and attribute-driven:

```html
<openleaf-editor
  for="body"
  menubar
  toolbar2="undo redo"
  toolbar-overflow
  selection-toolbar="bold italic | link"
  insert-toolbar="link image"
  formats="p.lead=Lead paragraph|.note=Note"
  content-css="/css/article.css"
  lang="fr"
  inline
  autoresize
></openleaf-editor>
```

- **Menubar** — `menubar` enables Edit, Insert, Format, View, and Help.
- **Context menus** — right-click a link, image, or table. An image offers
  **Edit image** and prefills the dialog from the selected picture. Set
  `contextmenu="none"` to disable.
- **Floating toolbars** — `selection-toolbar` and `insert-toolbar`.
- **Fullscreen, help, visual aids** — toolbar ids `fullscreen`, `help`, `visualAids`. F1 opens help.
- **Autoresize / inline** — grow with content, or hide chrome until focus.
- **Autolink** — URLs become links on space or Enter. Trailing sentence punctuation and unmatched `)]}'"` stay outside the mark; a balanced `)` in the path (Wikipedia-style) stays in. Set `autolink="false"` to disable.
- **Formats** — class names from the host’s content CSS, applied to the current block.
- **Translations** — `lang` plus `registerTranslations('fr', { Bold: 'Gras' })`.
- **Non-editable regions** — `contenteditable="false"` in stored HTML is honoured while editing and still round-trips.

First-party wrappers keep the same element underneath:

```ts
import { OpenLeafEditor } from '@openleaf-editor/react'
import { OpenLeafEditor as VueOpenLeaf } from '@openleaf-editor/vue'
```

Angular has no wrapper package: it consumes the custom element directly, with
`CUSTOM_ELEMENTS_SCHEMA` and a short directive for `[(value)]`. See
[packages/angular](packages/angular) for the recipe and for why the wrapper that
used to be published was withdrawn.

## Optional plugins

Plugins remain separate so applications only ship the features they use. Keep
all `@openleaf-editor/*` packages on the same version.

```bash
npm install \
  @openleaf-editor/plugins-table@beta \
  @openleaf-editor/plugins-colour@beta \
  @openleaf-editor/plugins-highlight@beta \
  @openleaf-editor/plugins-import@beta \
  @openleaf-editor/plugins-import-docx@beta \
  @openleaf-editor/plugins-session@beta \
  @openleaf-editor/plugins-insert@beta
```

```ts
import { installTableEditing } from '@openleaf-editor/plugins-table'
import { installColourPicker } from '@openleaf-editor/plugins-colour'
import { installSyntaxHighlighting } from '@openleaf-editor/plugins-highlight'
import { installImport } from '@openleaf-editor/plugins-import'
import { installDocxImport } from '@openleaf-editor/plugins-import-docx'
import { installSessionTools } from '@openleaf-editor/plugins-session'
import { installInsertTools } from '@openleaf-editor/plugins-insert'

installTableEditing()
installColourPicker()
installSyntaxHighlighting()
installImport()
installDocxImport()
installSessionTools()
installInsertTools()
```

Installing a plugin registers its capabilities; it does not rearrange a custom
toolbar. Add the plugin controls to the `toolbar` attribute where you want them,
by id:

| Plugin | Toolbar item ids |
| --- | --- |
| `plugins-table` | `insertTable`, `tableProperties`, `rowProperties`, `cellProperties`, `tableCaption`, `addRowBefore`, `addRowAfter`, `deleteRow`, `addColumnBefore`, `addColumnAfter`, `deleteColumn`, `mergeCells`, `splitCell`, `toggleHeaderRow`, `deleteTable` |
| `plugins-insert` | `media`, `details`, `anchor`, `charmap`, `emoji`, `datetime`, `pagebreak`, `nbsp`, `snippet` |
| `plugins-session` | `find`, `wordCount`, `save`, `preview`, `print`, `newDocument` |
| `plugins-colour` | `textColour`, `highlightColour` |
| `plugins-import` | `importFile` |
| `plugins-import-docx` | none — it registers a converter behind `importFile` |
| `plugins-highlight` | none — it changes how code blocks render |

An id in the `toolbar` string that nothing has registered produces a
`console.warn` rather than being silently skipped, so a typo is visible.

`plugins-import-docx` needs `plugins-import` installed **and** `installImport()`
called first: it registers a converter with the `importFile` control that
package owns, so on its own there is no control to reach it through.

## Packages

| Package | Purpose |
| --- | --- |
| [`@openleaf-editor/element`](packages/element) | Drop-in `<openleaf-editor>` custom element |
| [`@openleaf-editor/core`](packages/core) | Schema, commands, HTML I/O, and content preservation |
| [`@openleaf-editor/paste`](packages/paste) | Word and Google Docs paste normalization |
| [`@openleaf-editor/ui`](packages/ui) | Toolbar, menus, dialogs, icons, skins, and theme tokens |
| [`@openleaf-editor/sanitize`](packages/sanitize) | Canonical allowlist and sanitizer adapters |
| [`@openleaf-editor/content-policy`](packages/content-policy) | URL, CSS, and embed rules shared by the editor and the sanitizers |
| [`@openleaf-editor/react`](packages/react) | React wrapper around the custom element |
| [`@openleaf-editor/vue`](packages/vue) | Vue 3 wrapper around the custom element |
| [`@openleaf-editor/plugins-table`](packages/plugins-table) | Table editing controls and behavior |
| [`@openleaf-editor/plugins-colour`](packages/plugins-colour) | Text and highlight color pickers |
| [`@openleaf-editor/plugins-highlight`](packages/plugins-highlight) | Code highlighting and formatted source view |
| [`@openleaf-editor/plugins-import`](packages/plugins-import) | HTML and plain-text file import |
| [`@openleaf-editor/plugins-import-docx`](packages/plugins-import-docx) | Microsoft Word `.docx` import via Mammoth |
| [`@openleaf-editor/plugins-session`](packages/plugins-session) | Find and replace, word count, autosave, save, print, preview, and new document |
| [`@openleaf-editor/plugins-insert`](packages/plugins-insert) | Media, details, anchors, character map, emoji, snippets, and image resize |

## Documentation

- [Integration guide](docs/integrating-openleaf.md) — framework selection,
  installation, security requirements, working examples, and verification
- [API reference](docs/api-reference.md) — the element's attributes,
  properties, and `openleaf:*` events.
- [Authoring plugins](docs/authoring-plugins.md) — schema extensions, toolbar
  items, and the interactions that will cost you a day.
- [SECURITY.md](SECURITY.md) — the threat model, the plugin trust model, and a
  baseline CSP.
- [GOVERNANCE.md](GOVERNANCE.md) — the licence, the DCO, and the product
  covenants.

## Content fidelity

OpenLeaf applies different rules to different sources:

| Source | Policy |
| --- | --- |
| Stored HTML | Preserve content and attributes; unknown markup remains intact |
| Pasted HTML | Remove vendor noise while preserving text and document structure |
| Imported files | Convert through the same normalized insertion pipeline used by paste |

Round-trip fixtures cover legacy CMS markup, bidirectional text, nested lists,
tables, Word, and Google Docs. A change that reduces stored-content fidelity is
treated as a regression even when the resulting HTML appears cleaner. The link
dialog is part of that contract: Save merges `noopener noreferrer` onto an
existing `rel` when the link opens in a new window, and it round-trips `id`.
It does not replace author tokens such as `nofollow` or `sponsored`.

If OpenLeaf changes or drops real-world markup from your CMS, a redacted fixture
is one of the most useful contributions you can make. See
[Contributing](CONTRIBUTING.md) for the fixture workflow.

## Image uploads

URL-based image insertion works by default. To enable file selection, paste, and
drag-and-drop, register an uploader backed by your own endpoint:

```ts
import { registerImageUploader } from '@openleaf-editor/element'

registerImageUploader(async (file) => {
  const body = new FormData()
  body.append('file', file)

  const response = await fetch('/media', { method: 'POST', body })
  if (!response.ok) throw new Error('The image could not be uploaded.')
  return response.json()
})
```

The uploader may return a URL string or an object containing `src` and optional
`alt`, `title`, `width`, and `height` values.

## Security

Client-side filtering is not a security boundary. Sanitize all submitted HTML in
a trusted server environment before storing or rendering it.

`@openleaf-editor/sanitize` exposes a single policy and adapters for DOMPurify,
Python Bleach, and PHP HTMLPurifier, helping client and server configurations stay
aligned. If your application intentionally preserves custom elements or
attributes, extend the policy explicitly rather than accepting arbitrary markup.

Read [SECURITY.md](SECURITY.md) for the threat model, supported versions,
responsible disclosure process, and integration guidance.

## Project status

The document model, preservation layer, paste normalization, toolbar, textarea
integration, sanitization policy, and optional plugin architecture are implemented
and covered by automated tests. The project is still beta because several
production-readiness areas need broader validation:

- Real screen-reader testing and a published accessibility conformance report
- Mobile, touch-selection, soft-keyboard, and IME coverage
- Production feedback across varied CMS environments and legacy HTML archives

Accessibility is a release criterion, not a badge inferred from automated checks.
OpenLeaf currently makes no WCAG conformance claim.

## Development

Requirements:

- Node.js 20 or newer
- pnpm 11.13.1, as declared by `packageManager`

```bash
git clone https://github.com/PeytonNowlin/openleaf.git
cd openleaf
pnpm install
pnpm exec playwright install
pnpm verify
```

Useful commands:

| Command | Description |
| --- | --- |
| `pnpm test` | Run unit and round-trip fidelity tests |
| `pnpm test:watch` | Run unit tests in watch mode |
| `pnpm test:e2e:quick` | Run browser tests in Chromium |
| `pnpm test:e2e:ui` | Open Playwright's interactive runner |
| `pnpm verify:quick` | Run the complete local gate with Chromium only |
| `pnpm verify` | Build, test in all browsers, and check architecture and size budgets |

Run `pnpm verify` before opening a pull request. It is the authoritative local
quality gate and mirrors the checks in the GitHub Actions workflow.

## Contributing

Bug reports, real-world fidelity fixtures, accessibility testing, documentation,
and focused feature contributions are welcome. Before starting, read
[CONTRIBUTING.md](CONTRIBUTING.md) for project scope, testing expectations, commit
format, and the Developer Certificate of Origin sign-off requirement.

Use the repository's [issue tracker](https://github.com/PeytonNowlin/openleaf/issues)
for bugs and feature proposals. Security vulnerabilities should follow the private
reporting process in [SECURITY.md](SECURITY.md), not a public issue.

## Governance and license

OpenLeaf is licensed under the [Apache License 2.0](LICENSE). Commercial,
closed-source, and hosted use is permitted under the terms of that license.

The project uses the [Developer Certificate of Origin](https://developercertificate.org/)
instead of a copyright-assignment CLA. Its governance commitments—including no
paid feature tier, license keys, telemetry, or required hosted service—are
documented in [GOVERNANCE.md](GOVERNANCE.md).

Please follow the [Code of Conduct](CODE_OF_CONDUCT.md) in all project spaces.
