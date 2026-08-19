/**
 * Entry point for the opt-in file import bundle.
 *
 * It also publishes its own module namespace onto the host runtime. Without
 * that, a companion bundle -- `openleaf-import-docx.min.js` -- would bundle its
 * own copy of this package and register its converter into a *second*, private
 * registry that nothing ever reads. Measured, not theorised: dropping a .docx
 * reported "not a format this editor can import" while the converter sat
 * installed in the wrong array.
 *
 * Same failure as two copies of ProseMirror giving you two schemas, one level up.
 */
import * as importApi from '@openleaf-editor/plugins-import'

importApi.installImport()

const host = (globalThis as { OpenLeaf?: { __runtime?: Record<string, unknown> } }).OpenLeaf
if (host?.__runtime) host.__runtime['@openleaf-editor/plugins-import'] = importApi
