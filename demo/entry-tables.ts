/**
 * Entry point for the opt-in table bundle.
 *
 * Installing on load is the whole point of a script tag: an integrator adds the
 * file and gets table editing, with no initialisation call to forget.
 */
import { installTableEditing } from '@openleaf-editor/plugins-table'

installTableEditing()
