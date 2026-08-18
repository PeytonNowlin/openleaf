/**
 * mammoth ships types for its Node entry but not for the browser build, which is
 * the one this package uses -- the Node entry pulls in `fs` and would not bundle.
 * The two have the same surface, so the declaration simply points at it.
 */
declare module 'mammoth/mammoth.browser.js' {
  import type mammothTypes from 'mammoth'

  interface BrowserMammoth {
    convertToHtml: typeof mammothTypes.convertToHtml
    extractRawText: typeof mammothTypes.extractRawText
    images: {
      imgElement(
        convert: (image: {
          contentType: string
          read: (encoding?: string) => Promise<string | Buffer>
        }) => Promise<{ src: string; alt?: string }>,
      ): NonNullable<Parameters<typeof mammothTypes.convertToHtml>[1]>['convertImage']
    }
  }

  const mammoth: BrowserMammoth
  export default mammoth
}
