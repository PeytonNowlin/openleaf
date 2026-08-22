/**
 * ProseMirror types re-exported so a plugin needs no direct dependency on
 * ProseMirror to be written against this API.
 *
 * Type-only, so they add nothing to any bundle. Without them, writing a
 * `Command` or a `NodeSpec` meant adding `prosemirror-state` and
 * `prosemirror-model` to the plugin's own package -- and getting a *second*
 * copy of either of them is how a node built by one schema stops being a node
 * type the editor accepts.
 */
export type { Command } from 'prosemirror-state'
export type { MarkSpec, NodeSpec, Schema } from 'prosemirror-model'

export { OpenLeafError, isOpenLeafError, type OpenLeafErrorCode } from './errors.js'
export { baseSchema, coreMarks, coreNodes } from './schema.js'
export {
  ALIGNMENTS,
  COLOUR_PROPERTIES,
  FONT_FAMILIES,
  FONT_SIZE_PRESETS,
  INDENT_EM,
  INLINE_STYLE_PROPERTIES,
  LINE_HEIGHT_PRESETS,
  LIST_STYLES,
  MAX_INDENT,
  MODELLED_PROPERTIES,
  indentCss,
  indentLevels,
  isFullyModelledStyle,
  modelledValue,
  parseDeclarations,
  safeAlign,
  safeColor,
  safeDir,
  safeFontFamily,
  safeFontSize,
  safeLang,
  safeLineHeight,
  safeListStyle,
  serializeDeclarations,
  type Align,
  type Dir,
  type ListStyle,
} from './css.js'
export { MAX_PARSE_DEPTH, parseHtml, serializeHtml, roundTrip, type HtmlIOOptions } from './html.js'
export {
  isLosslesslyUnwrappable,
  // Required reading for plugin authors -- `docs/authoring-plugins.md` §4.1 tells
  // a command to call this before touching a node, because editing inside
  // preserved markup breaks the byte-identical promise the layer exists to keep.
  // It was documented as mandatory and was not exported.
  isInsidePreserved,
  unknownBlock,
  unknownInline,
} from './preserve.js'
export {
  URL_ATTRIBUTES,
  isEventHandlerAttribute,
  isSafeUrl,
  safeUrlOrNull,
} from './url.js'
export {
  EMBED_HOSTS,
  embedSrcFor,
  isAllowedEmbedSrc,
  safeAllowList,
  safeEmbedSrc,
  type EmbedHostRule,
} from './embed.js'
export {
  IMAGE_ALIGNMENTS,
  IMAGE_ALIGN_CLASS,
  IMAGE_ALIGN_CLASSES,
  imageAlignFromClass,
  safeClassList,
  safeId,
  type ImageAlign,
} from './tokens.js'
export {
  // predicates
  activeBackgroundColor,
  activeDir,
  activeFontFamily,
  activeFontSize,
  activeHeadingLevel,
  activeIndent,
  activeLanguage,
  activeLineHeight,
  activeLink,
  activeListStyle,
  activeTextAlign,
  activeTextColor,
  canInsert,
  canRedo,
  canUndo,
  isMarkActive,
  isNodeActive,
  // marks
  toggleBold,
  toggleInlineCode,
  toggleItalic,
  toggleStrike,
  toggleSubscript,
  toggleSuperscript,
  toggleUnderline,
  // colour
  clearBackgroundColor,
  clearTextColor,
  setBackgroundColor,
  setTextColor,
  // typography
  setFontFamily,
  setFontSize,
  setLanguage,
  clearFormatting,
  // blocks
  insertHorizontalRule,
  setDir,
  setHeading,
  setLineHeight,
  setParagraph,
  setTextAlign,
  toggleBlockquote,
  toggleCodeBlock,
  toggleDir,
  toggleHeading,
  toggleTextAlign,
  wrapInBlockquote,
  insertAudio,
  insertDetails,
  insertHtml,
  insertIframe,
  insertNamedAnchor,
  insertNonBreakingSpace,
  insertPageBreak,
  insertText,
  insertVideo,
  setHeadingId,
  // lists
  indent,
  indentListItem,
  outdent,
  outdentListItem,
  setListStyle,
  splitListItemCommand,
  toggleBulletList,
  toggleOrderedList,
  // links and images
  insertImage,
  selectedMedia,
  setLink,
  unsetLink,
  updateMedia,
  type ImageAttrs,
  type LinkAttrs,
  type MediaAttrs,
  type MediaSource,
  type SelectedMedia,
  // history
  redo,
  undo,
} from './commands.js'
export {
  buildKeymap,
  shortcutFor,
  shortcuts,
  type Shortcut,
} from './keymap.js'
export { autolinkPlugin, hrefFromTypedUrl } from './autolink.js'
export { visualAidsPlugin } from './visual-aids.js'
export { disclosurePlugin } from './disclosure.js'
export { isNonEditableNode, nonEditablePlugin } from './noneditable.js'
export {
  activeBlockClass,
  carriedClass,
  formatParts,
  parseFormatList,
  setBlockClass,
  type FormatParts,
  type FormatSpec,
} from './formats.js'
export {
  createRegisteredPlugins,
  onEditorPluginsChange,
  registerEditorPlugin,
  type EditorPluginFactory,
} from './plugins.js'
// The table node specs themselves are no longer exported. They were raw,
// mutable `NodeSpec` objects, and a consumer holding one could edit the schema
// every editor on the page is built from. `coreSchema().nodes['table']` is the
// supported way to reach a table node type, and nothing outside this package
// ever imported the specs. `safeTableStyleValue` stays: the property dialogs in
// @openleaf-editor/plugins-table share it with the parse path, so a dialog
// writing attributes directly cannot disagree with the schema about an
// acceptable padding -- which is how `padding: 0;position:fixed;inset:0` got in.
export { safeTableStyleValue } from './tables.js'
// `CARRIED_ATTR` is no longer exported. Its own docstring said "it is not for
// plugin authors", and it names an internal attribute slot whose contents the
// carry mechanism owns; a plugin writing to it corrupts the residue that keeps
// unmodelled attributes alive across a round trip.
export {
  coreSchema,
  createSchema,
  // Kept, and both are load-bearing across a package boundary: the element
  // subscribes to `onSchemaExtensionsChange` to warn about a schema that
  // arrived too late, and `registeredSchemaExtensions` returns a fresh array
  // rather than the registry, so it publishes what is installed without
  // publishing the ability to change it.
  onSchemaExtensionsChange,
  registerSchemaExtension,
  registeredSchemaExtensions,
  type SchemaExtension,
} from './extensions.js'
