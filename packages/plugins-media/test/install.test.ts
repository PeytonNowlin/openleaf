import { describe, expect, it } from 'vitest'
import { installMediaEditing, MEDIA_TOOLBAR_ITEMS } from '../src/index.js'

describe('installMediaEditing', () => {
  it('is idempotent', () => {
    installMediaEditing()
    installMediaEditing()
    expect(MEDIA_TOOLBAR_ITEMS).toEqual(['insertMedia'])
  })
})