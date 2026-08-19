/**
 * Entry point for the opt-in media bundle.
 *
 * Installing on load is the whole point of a script tag: an integrator adds the
 * file and gets drag-resize and the media dialog, with no initialisation call
 * to forget.
 */
import { installMediaEditing } from '@openleaf-editor/plugins-media'

installMediaEditing()
