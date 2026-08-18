export { schema } from './schema.js'
export { parseHtml, serializeHtml, roundTrip, type HtmlIOOptions } from './html.js'
export { isLosslesslyUnwrappable, unknownBlock, unknownInline } from './preserve.js'
export {
  // predicates
  activeHeadingLevel,
  activeLink,
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
  toggleUnderline,
  // blocks
  insertHorizontalRule,
  setHeading,
  setParagraph,
  toggleBlockquote,
  toggleCodeBlock,
  toggleHeading,
  wrapInBlockquote,
  // lists
  indentListItem,
  outdentListItem,
  splitListItemCommand,
  toggleBulletList,
  toggleOrderedList,
  // links and images
  insertImage,
  setLink,
  unsetLink,
  type ImageAttrs,
  type LinkAttrs,
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
