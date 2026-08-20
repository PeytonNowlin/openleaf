/**
 * The image upload hook.
 *
 * The interesting behaviour is all in the refusals: what happens with no
 * uploader, what happens when an uploader reports something the schema would not
 * store, and which uploader wins when a page has both a global one and a
 * per-editor one.
 */

import { afterEach, describe, expect, it } from 'vitest'
import {
  canUploadImages,
  dimension,
  imageFilesFrom,
  imageUploaderFor,
  isUploadableImage,
  registerImageUploader,
  runUploader,
  type ImageUploader,
} from '../src/upload.js'

function file(name: string, type: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type })
}

afterEach(() => {
  registerImageUploader(null)
})

describe('registration', () => {
  it('offers no upload until one is registered', () => {
    const host = document.createElement('div')
    expect(canUploadImages(host)).toBe(false)
    expect(imageUploaderFor(host)).toBeNull()
  })

  it('lets an element override the page-wide uploader', () => {
    // A page with two editors posting to different endpoints cannot express that
    // any other way, which is the only reason two mechanisms exist.
    const global: ImageUploader = async () => ({ src: '/global.png' })
    const own: ImageUploader = async () => ({ src: '/own.png' })
    registerImageUploader(global)

    const plain = document.createElement('div')
    const custom = Object.assign(document.createElement('div'), { imageUploader: own })

    expect(imageUploaderFor(plain)).toBe(global)
    expect(imageUploaderFor(custom)).toBe(own)
  })

  it('treats a null element property as no override', () => {
    const global: ImageUploader = async () => ({ src: '/global.png' })
    registerImageUploader(global)
    const host = Object.assign(document.createElement('div'), { imageUploader: null })
    // `?? global` rather than `||`: an explicit null means "nothing set here",
    // which is different from an uploader that happens to be falsy.
    expect(imageUploaderFor(host)).toBe(global)
  })
})

describe('which files are claimed', () => {
  it('accepts bitmaps and refuses SVG', () => {
    expect(isUploadableImage(file('a.png', 'image/png'))).toBe(true)
    expect(isUploadableImage(file('a.avif', 'image/avif'))).toBe(true)
    // An SVG is a document: it can carry <script>, and deciding it is safe means
    // sanitizing its interior, which is the accepting server's job.
    expect(isUploadableImage(file('a.svg', 'image/svg+xml'))).toBe(false)
    expect(isUploadableImage(file('a.docx', 'application/vnd.openxmlformats'))).toBe(false)
  })

  it('picks the images out of a mixed drop, in order', () => {
    // A stand-in rather than a real DataTransfer, which jsdom does not implement.
    // Only `files` is read, and the real thing is exercised in the e2e suite where
    // a browser constructs one.
    const transfer = {
      files: [
        file('a.docx', 'application/msword'),
        file('b.png', 'image/png'),
        file('c.gif', 'image/gif'),
      ],
    } as unknown as DataTransfer

    expect(imageFilesFrom(transfer).map((f) => f.name)).toEqual(['b.png', 'c.gif'])
    expect(imageFilesFrom(null)).toEqual([])
  })
})

describe('running an uploader', () => {
  const host = document.createElement('div')

  it('accepts a bare string as shorthand for a source', async () => {
    const result = await runUploader(async () => '/uploads/a.png', file('a.png', 'image/png'), host)
    expect(result.src).toBe('/uploads/a.png')
  })

  it('passes the file and the host through', async () => {
    // A holder rather than a `let`: a variable assigned only inside a callback
    // keeps its narrowed `null` type where it is read.
    const seen: { name?: string; host?: HTMLElement } = {}
    await runUploader(
      async (f, ctx) => {
        seen.name = f.name
        seen.host = ctx.host
        return '/uploads/a.png'
      },
      file('a.png', 'image/png'),
      host,
    )
    expect(seen.name).toBe('a.png')
    expect(seen.host).toBe(host)
  })

  it('refuses a URL the schema would drop', async () => {
    // Otherwise a compromised media library or a misconfigured proxy puts a
    // javascript: URL in the document, the schema drops it on the next parse, and
    // the author cannot tell whether the upload or the editor lost their image.
    await expect(
      runUploader(async () => 'javascript:alert(1)', file('a.png', 'image/png'), host),
    ).rejects.toThrow(/will not store/)
  })

  it('refuses a result with no source at all', async () => {
    await expect(
      runUploader(async () => ({ src: '' }), file('a.png', 'image/png'), host),
    ).rejects.toThrow(/no address/)
  })

  it('lets an uploader failure through unchanged, for the dialog to show', async () => {
    await expect(
      runUploader(
        async () => {
          throw new Error('The server rejected the upload.')
        },
        file('a.png', 'image/png'),
        host,
      ),
    ).rejects.toThrow('The server rejected the upload.')
  })
})

describe('dimensions', () => {
  it('keeps usable numbers and drops everything else', () => {
    expect(dimension(320)).toBe('320')
    expect(dimension('320')).toBe('320')
    expect(dimension(319.6)).toBe('320')
    expect(dimension(0)).toBeNull()
    expect(dimension(-5)).toBeNull()
    expect(dimension('wide')).toBeNull()
    expect(dimension(null)).toBeNull()
    expect(dimension(undefined)).toBeNull()
  })
})
