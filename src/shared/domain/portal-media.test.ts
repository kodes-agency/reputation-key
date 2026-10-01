import { describe, expect, it } from 'vitest'
import {
  PORTAL_MEDIA_PURPOSES,
  PORTAL_MEDIA_SOURCE_FORMATS,
  PORTAL_MEDIA_STATUSES,
  portalMediaObjectKey,
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
