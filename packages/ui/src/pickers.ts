/**
 * Shared pickers: file, image and media, plus optional link and image lists.
 *
 * OpenLeaf has no media library. What it can own is the seam a CMS already has
 * -- "open our file browser and give me a URL" -- so the link dialog, the
 * image dialog and the media dialog all call the same function. Registering
 * three uploaders that each talk to the same endpoint is how this used to go
 * wrong in every other editor.
 *
 * Lists are separate: they are the short, known set of destinations a site
 * wants to offer (the privacy policy, a hero image), not a replacement for
 * the library.
 */

export type FilePickerKind = 'file' | 'image' | 'media'

export interface PickedResource {
  url: string
  title?: string
  text?: string
  alt?: string
}

export type FilePicker = (meta: {
  kind: FilePickerKind
  host: HTMLElement
}) => Promise<PickedResource | null>

export interface ListedResource {
  /** Shown in the list. */
  title: string
  /** The URL inserted. */
  value: string
}

type ListSource = readonly ListedResource[] | (() => readonly ListedResource[])

let globalPicker: FilePicker | null = null
let linkList: ListSource | null = null
let imageList: ListSource | null = null
let imageClasses: readonly string[] | (() => readonly string[]) | null = null

interface HostWithPicker extends HTMLElement {
  filePicker?: FilePicker | null
}

/** Register the shared file picker for every editor on the page. `null` removes it. */
export function registerFilePicker(picker: FilePicker | null): void {
  globalPicker = picker
}

export function filePickerFor(host: HTMLElement | null | undefined): FilePicker | null {
  const own = (host as HostWithPicker | null | undefined)?.filePicker
  return own ?? globalPicker
}

export function registerLinkList(list: ListSource | null): void {
  linkList = list
}

export function registerImageList(list: ListSource | null): void {
  imageList = list
}

/** Class names offered in the image dialog. Authors can still type others. */
export function registerImageClasses(
  list: readonly string[] | (() => readonly string[]) | null,
): void {
  imageClasses = list
}

function resolveList(source: ListSource | null): ListedResource[] {
  if (!source) return []
  return [...(typeof source === 'function' ? source() : source)]
}

export function listedLinks(): ListedResource[] {
  return resolveList(linkList)
}

export function listedImages(): ListedResource[] {
  return resolveList(imageList)
}

export function listedImageClasses(): string[] {
  if (!imageClasses) return []
  return [...(typeof imageClasses === 'function' ? imageClasses() : imageClasses)]
}
