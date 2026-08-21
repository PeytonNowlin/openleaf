/**
 * Telling the author what happened.
 *
 * An import that quietly drops images is the same failure as an editor that
 * quietly drops markup -- the author finds out weeks later, with the original
 * long closed. So conversion warnings are shown, not logged.
 *
 * A polite live region rather than an alert: the insertion already happened and
 * the author should not have to dismiss anything to carry on typing.
 */

// The region itself is the editor's, not this plugin's. Two polite regions on
// one host race each other and a screen reader reads whichever it noticed, in
// whichever order -- which is why this used to build a second one and why it
// no longer does.
export { announce } from '@openleaf-editor/ui'

export function describeOutcome(
  fileCount: number,
  warnings: readonly string[],
  error: string | undefined,
): string {
  if (error) return error
  const imported = fileCount === 1 ? 'File imported.' : `${fileCount} files imported.`
  if (warnings.length === 0) return imported
  return `${imported} ${warnings.length} thing${warnings.length === 1 ? '' : 's'} did not come across: ${warnings.join('; ')}`
}
