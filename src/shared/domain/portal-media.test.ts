import { describe, expect, it } from 'vitest'
import {
  PORTAL_MEDIA_PURPOSES,
  PORTAL_MEDIA_SOURCE_FORMATS,
  PORTAL_MEDIA_STATUSES,
  portalMediaObjectKey,
  portalMediaSizeProblem,
  portalMediaPublicPath,
} from './portal-media'

describe('portal media vocabulary', () => {
  it('names the three things an image is for', () => {
    expect([...PORTAL_MEDIA_PURPOSES]).toEqual(['hero', 'logo', 'link_image'])
  })

  it('knows two states, so a taken-down image is distinct from a missing one', () => {
    expect([...PORTAL_MEDIA_STATUSES]).toEqual(['active', 'taken_down'])
  })

  it('accepts uploads only in the three raster formats', () => {
    expect([...PORTAL_MEDIA_SOURCE_FORMATS]).toEqual(['jpeg', 'png', 'webp'])
  })

  it('derives an object key from the asset id alone', () => {
    expect(portalMediaObjectKey('abc')).toBe('portal-media/abc.webp')
  })

  it("serves an asset from the app's own origin, never from the bucket", () => {
    expect(portalMediaPublicPath('abc')).toBe('/api/public/portal-media/abc')
    expect(portalMediaPublicPath('abc').startsWith('/')).toBe(true)
  })
})

describe('portalMediaSizeProblem', () => {
  it('accepts a photograph that is big enough and not extreme', () => {
    expect(portalMediaSizeProblem('hero', 4032, 3024)).toBeNull()
    expect(portalMediaSizeProblem('hero', 1000, 500)).toBeNull()
    expect(portalMediaSizeProblem('hero', 500, 1000)).toBeNull()
  })

  it('says too small when either edge is short, whichever way the picture is turned', () => {
    expect(portalMediaSizeProblem('hero', 999, 700)).toBe('too_small')
    expect(portalMediaSizeProblem('hero', 700, 999)).toBe('too_small')
    expect(portalMediaSizeProblem('hero', 1600, 499)).toBe('too_small')
  })

  it('says extreme when the picture is far wider or taller than the purpose allows', () => {
    expect(portalMediaSizeProblem('hero', 4000, 1000)).toBeNull()
    expect(portalMediaSizeProblem('hero', 4001, 1000)).toBe('extreme_aspect')
    expect(portalMediaSizeProblem('logo', 1600, 200)).toBeNull()
    expect(portalMediaSizeProblem('logo', 1608, 200)).toBe('extreme_aspect')
  })

  it('names too small before too extreme, as the image policy does', () => {
    expect(portalMediaSizeProblem('hero', 900, 100)).toBe('too_small')
  })

  it('holds a logo to its own, smaller minimum', () => {
    expect(portalMediaSizeProblem('logo', 128, 64)).toBeNull()
    expect(portalMediaSizeProblem('logo', 127, 64)).toBe('too_small')
  })
})
