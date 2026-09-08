# Embedded CSS in CMS modules

AW's HTML modules use embedded style blocks for hero layouts. The default editor drops those blocks. Add an explicit `preserve-styles` editor option and matching core schema/HTML option for trusted CMS content, while retaining the default filtering policy.

Store extracted CSS and its media condition as document metadata, including nested style blocks. Never mount the original style tags into the live admin document. Serialize the metadata back as leading style blocks; use the same schema and document attributes for value assignment, Source, reset and undo.

Render a per-editor constructable sheet bounded by CSS @scope to that editor's canvas. Permit style rules and conditional/grouping rules; preserve but do not activate document-global rules such as imports/font definitions. This avoids letting module CSS change editor controls or other editor instances. The normal content-css option remains available for integrator-owned font/style resources.

Verify CSS retention, default filtering, script filtering, source round-trips, CSS-only edits and undo, reused-editor resets, visible hero styles, and isolation in Chromium/Firefox/WebKit. Update docs and changelog. Build and test an AW candidate against local packages before requesting an upstream release; do not manually bump package versions.
