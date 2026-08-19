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
- Word and Google Docs paste cleanup, including nested list reconstruction
- Keyboard-accessible toolbar with configurable controls and themes
- Alignment, links, images, lists, block quotes, code blocks, and source view
- Optional tables, color controls, syntax highlighting, and file import
- Shared sanitization policy for browser, Node.js, Python, and PHP integrations
- Strict TypeScript with unit, fidelity, and cross-browser test suites
- Apache-2.0 licensed with no feature-gated commercial edition

## Quick start

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

The textarea is updated whenever the document changes and immediately before
form submission. Set its initial value to load existing HTML. When rendering
stored HTML inside a textarea from a server template, escape it for the textarea
context.

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

## Optional plugins

Plugins remain separate so applications only ship the features they use. Keep
all `@openleaf-editor/*` packages on the same version.

```bash
npm install \
  @openleaf-editor/plugins-table@beta \
  @openleaf-editor/plugins-colour@beta \
  @openleaf-editor/plugins-highlight@beta \
  @openleaf-editor/plugins-import@beta \
  @openleaf-editor/plugins-import-docx@beta
```

```ts
import { installTableEditing } from '@openleaf-editor/plugins-table'
import { installColourPicker } from '@openleaf-editor/plugins-colour'
import { installSyntaxHighlighting } from '@openleaf-editor/plugins-highlight'
import { installImport } from '@openleaf-editor/plugins-import'
import { installDocxImport } from '@openleaf-editor/plugins-import-docx'

installTableEditing()
installColourPicker()
installSyntaxHighlighting()
installImport()
installDocxImport()
```

Installing a plugin registers its capabilities; it does not rearrange a custom
toolbar. Add the plugin controls to the `toolbar` attribute where you want them.

## Packages

| Package | Purpose |
| --- | --- |
| [`@openleaf-editor/element`](packages/element) | Drop-in `<openleaf-editor>` custom element |
| [`@openleaf-editor/core`](packages/core) | Schema, commands, HTML I/O, and content preservation |
| [`@openleaf-editor/paste`](packages/paste) | Word and Google Docs paste normalization |
| [`@openleaf-editor/ui`](packages/ui) | Toolbar, dialogs, icons, skins, and theme tokens |
| [`@openleaf-editor/sanitize`](packages/sanitize) | Canonical allowlist and sanitizer adapters |
| [`@openleaf-editor/plugins-table`](packages/plugins-table) | Table editing controls and behavior |
| [`@openleaf-editor/plugins-colour`](packages/plugins-colour) | Text and highlight color pickers |
| [`@openleaf-editor/plugins-highlight`](packages/plugins-highlight) | Code highlighting and formatted source view |
| [`@openleaf-editor/plugins-import`](packages/plugins-import) | HTML and plain-text file import |
| [`@openleaf-editor/plugins-import-docx`](packages/plugins-import-docx) | Microsoft Word `.docx` import via Mammoth |

For schema extensions and custom toolbar items, see
[Authoring OpenLeaf plugins](docs/authoring-plugins.md).

## Content fidelity

OpenLeaf applies different rules to different sources:

| Source | Policy |
| --- | --- |
| Stored HTML | Preserve content and attributes; unknown markup remains intact |
| Pasted HTML | Remove vendor noise while preserving text and document structure |
| Imported files | Convert through the same normalized insertion pipeline used by paste |

Round-trip fixtures cover legacy CMS markup, bidirectional text, nested lists,
tables, Word, and Google Docs. A change that reduces stored-content fidelity is
treated as a regression even when the resulting HTML appears cleaner.

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
- Known table fidelity gaps for `<caption>` and `<colgroup>`

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
