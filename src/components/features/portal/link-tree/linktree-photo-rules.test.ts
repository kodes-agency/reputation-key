import { describe, expect, it } from 'vitest'
import type { PortalLinktreeLink } from '#/contexts/portal/application/public-api'
import {
  iconChoiceWrite,
  linkPhotoUrl,
  photoChoiceWrite,
  uploadTileLabel,
} from './linktree-photo-rules'

const ASSET = '30000000-0000-4000-8000-000000000001'

const link = (overrides: Partial<PortalLinktreeLink> = {}): PortalLinktreeLink => ({
  id: 'l-1',
  categoryId: 'c-1',
  url: 'https://avela.bg/menu',
  iconKey: 'utensils',
  imageAssetId: null,
  sortKey: 'a0',
  texts: [],
  destination: { state: 'approved', sourceType: 'custom', approvedByUserId: 'u-1' },
  ...overrides,
})

describe('linkPhotoUrl', () => {
  it('is null for a tile with no photo', () => {
    expect(linkPhotoUrl(link())).toBeNull()
  })

  it('is the same-origin address the stored image is served from', () => {
    expect(linkPhotoUrl(link({ imageAssetId: ASSET }))).toBe(
      `/api/public/portal-media/${ASSET}`,
    )
  })
})

describe('iconChoiceWrite', () => {
  it('saves the icon alone for a tile with no photo', () => {
    expect(iconChoiceWrite(link(), 'wifi')).toEqual({ linkId: 'l-1', iconKey: 'wifi' })
  })

  it('takes the photo off in the same write, because a tile is an icon or a photo, never both', () => {
    expect(iconChoiceWrite(link({ imageAssetId: ASSET }), 'wifi')).toEqual({
      linkId: 'l-1',
      iconKey: 'wifi',
      imageAssetId: null,
    })
  })
})

describe('photoChoiceWrite', () => {
  it('saves the uploaded picture for the tile and leaves the icon as it is', () => {
    expect(photoChoiceWrite(link(), ASSET)).toEqual({
      linkId: 'l-1',
      imageAssetId: ASSET,
    })
  })
})

describe('uploadTileLabel', () => {
  it('invites a photo when there is none, and a replacement when there is', () => {
    expect(uploadTileLabel(false)).toBe('Upload a photo instead of an icon')
    expect(uploadTileLabel(true)).toBe('Replace photo')
  })
})
