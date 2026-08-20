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

- **Tables no longer discard `<caption>`, `<colgroup>` and `<col>`.** These were
  dropped on parse, so opening and saving a captioned table destroyed its
  caption text permanently. A caption is a table's accessible name, which made
  this both a content-fidelity and an accessibility defect. All three now
  round-trip byte-identically. They render but are not yet editable in place:
  a caption has to be a child node to be edited, and `prosemirror-tables`
  derives its cell map from `table.childCount`, so that needs an upstream fix
  first. Content kept intact and inert beats content silently deleted.
- `@openleaf-editor/sanitize` allows `caption`, `colgroup` and `col` so the
  shared policy no longer strips markup the schema now preserves.
- `@openleaf-editor/plugins-table` renders the caption too. `columnResizing`
  installs a node view that builds the table element itself and never consults
  the schema's `toDOM`, so loading the table bundle hid the caption while
  editing even though saving still kept it -- an author had no way to tell it
  had survived except by reading the database.

### Changed

- The core bundle's gzip budget rises from 92 KB to 94 KB. The caption fix
  measured 91.955 KB against 92, a pass by 45 bytes, which leaves the next
  contributor's build failing for reasons unrelated to their patch.

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
