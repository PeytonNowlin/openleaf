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
  IMAGE_ACCEPT,
  canUploadImages,
  dimension,
  imageFilesFrom,
  imageUploaderFor,
  isHeicImage,
  isUploadableImage,
  isUploadableImageType,
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

  it('falls back to a filename when the type is empty', () => {
    // iOS and some file managers hand over type === "" with a name like
    // IMG_1234.PNG. Looking at type alone used to drop those on the floor, and
    // the browser then navigated to the file.
    expect(file('IMG_1234.PNG', '').type).toBe('')
    expect(isUploadableImage(file('IMG_1234.PNG', ''))).toBe(true)
    expect(isUploadableImage(file('photo.jpg', ''))).toBe(true)
    expect(isUploadableImage(file('scan.jfif', ''))).toBe(true)
    expect(isUploadableImage(file('shot.webp', ''))).toBe(true)
    // An extension is not a decoder. SVG stays refused even with no type, and
    // HEIC is refused rather than converted: OpenLeaf has no decoder and no
    // server.
    expect(isUploadableImage(file('icon.svg', ''))).toBe(false)
    expect(isUploadableImage(file('IMG_1234.HEIC', ''))).toBe(false)
    expect(isUploadableImage(file('notes.txt', ''))).toBe(false)
  })

  it('refuses HEIC and HEIF even when the type says they are images', () => {
    // image/heic is image/*, so the old type-only check passed these through
    // to the uploader. IMAGE_ACCEPT never offered HEIC in the picker, so the
    // two paths disagreed, and a CMS that only stores jpeg/png then failed
    // after the author had already described the file.
    expect(isUploadableImage(file('IMG_1234.HEIC', 'image/heic'))).toBe(false)
    expect(isUploadableImage(file('IMG_1234.HEIF', 'image/heif'))).toBe(false)
    expect(isUploadableImage(file('burst.heic', 'image/heic-sequence'))).toBe(false)
    expect(isHeicImage(file('IMG_1234.HEIC', 'image/heic'))).toBe(true)
    expect(isHeicImage(file('IMG_1234.HEIF', 'image/heif'))).toBe(true)
    expect(isHeicImage(file('IMG_1234.HEIC', ''))).toBe(true)
    expect(isHeicImage(file('photo.png', 'image/png'))).toBe(false)
  })

  it('gives the same answer for a media type with no file attached', () => {
    // The .docx importer asks this about images inside the ZIP, where there is
    // no File at all and the content type comes from whoever sent the document.
    expect(isUploadableImageType('image/png')).toBe(true)
    expect(isUploadableImageType('IMAGE/PNG')).toBe(true)
    expect(isUploadableImageType('image/svg+xml')).toBe(false)
    // A parameter, and a capitalised type, are both things a real file carries.
    expect(isUploadableImageType('image/svg+xml; charset=utf-8')).toBe(false)
    expect(isUploadableImageType('')).toBe(false)
    expect(isUploadableImageType(null)).toBe(false)
    // Type-only: a missing filename cannot promote HEIC, and an empty type
    // still cannot match. HEIC is refused here too so a .docx image with that
    // content type is dropped the same way a dropped file is.
    expect(isUploadableImageType('image/heic')).toBe(false)
    expect(isUploadableImageType('image/heif')).toBe(false)
  })

  it('offers JPEG in the picker, including the .jfif spelling', () => {
    expect(IMAGE_ACCEPT).toContain('image/jpeg')
    expect(IMAGE_ACCEPT).toContain('.jfif')
    expect(IMAGE_ACCEPT).not.toMatch(/heic/i)
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
        file('d.heic', 'image/heic'),
        file('IMG_1234.PNG', ''),
      ],
    } as unknown as DataTransfer

    expect(imageFilesFrom(transfer).map((f) => f.name)).toEqual(['b.png', 'c.gif', 'IMG_1234.PNG'])
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
