import { describe, expect, it } from 'vitest'
import type { PortalLinktreeLink } from '#/contexts/portal/application/public-api'
import {
  iconChoiceWrite,
  linkPhotoUrl,
  photoChoiceWrite,
  photoOnOffer,
  rememberPhotos,
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

describe('rememberPhotos', () => {
  const OTHER = '30000000-0000-4000-8000-000000000002'

  it('notes the photo of every tile that has one', () => {
    const links = [
      link({ id: 'l-1', imageAssetId: ASSET }),
      link({ id: 'l-2' }),
      link({ id: 'l-3', imageAssetId: OTHER }),
    ]

    expect(rememberPhotos({}, links)).toEqual({ 'l-1': ASSET, 'l-3': OTHER })
  })

  it('keeps a photo after the tile has been given an icon, so the photo can be chosen again', () => {
    const remembered = rememberPhotos({}, [link({ imageAssetId: ASSET })])

    expect(rememberPhotos(remembered, [link({ imageAssetId: null })])).toBe(remembered)
  })

  it('follows a tile to a newer photo', () => {
    const remembered = rememberPhotos({}, [link({ imageAssetId: ASSET })])

    expect(rememberPhotos(remembered, [link({ imageAssetId: OTHER })])).toEqual({
      'l-1': OTHER,
    })
  })

  it('hands back the same memory when nothing is new, so a render does not set state', () => {
    const remembered = { 'l-1': ASSET }

    expect(rememberPhotos(remembered, [link({ imageAssetId: ASSET })])).toBe(remembered)
  })
})

describe('photoOnOffer', () => {
  it('is the tile photo while it has one', () => {
    expect(photoOnOffer(link({ imageAssetId: ASSET }), 'other')).toBe(ASSET)
  })

  it('is the photo the tile last had once an icon replaced it', () => {
    expect(photoOnOffer(link(), ASSET)).toBe(ASSET)
  })

  it('is nothing for a tile that never had a photo', () => {
    expect(photoOnOffer(link(), null)).toBeNull()
  })
})
