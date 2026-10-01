import { describe, expect, it } from 'vitest'
import {
  PORTAL_MEDIA_REFERENCE_SLOTS,
  canReferencePortalMediaAsset,
  type PortalMediaReferenceSlot,
} from './portal-media-asset'

const asset = (
  purpose: 'hero' | 'logo' | 'link_image',
  status: 'active' | 'taken_down' = 'active',
) => ({ purpose, status })

describe('canReferencePortalMediaAsset', () => {
  it.each([
    ['brand_hero', 'hero'],
    ['brand_logo', 'logo'],
    ['link_image', 'link_image'],
  ] as const)('lets %s refer to a %s asset', (slot, purpose) => {
    expect(canReferencePortalMediaAsset(slot, asset(purpose))).toBe(true)
  })

  it('refuses an asset uploaded for another purpose, which the foreign keys alone would accept', () => {
    expect(canReferencePortalMediaAsset('brand_hero', asset('link_image'))).toBe(false)
    expect(canReferencePortalMediaAsset('brand_logo', asset('hero'))).toBe(false)
    expect(canReferencePortalMediaAsset('link_image', asset('logo'))).toBe(false)
  })

  it('refuses an asset that has been taken down', () => {
    expect(canReferencePortalMediaAsset('brand_hero', asset('hero', 'taken_down'))).toBe(
      false,
    )
  })

  it('names every slot, so a new reference column has to choose its purpose', () => {
    const slots = Object.keys(PORTAL_MEDIA_REFERENCE_SLOTS) as PortalMediaReferenceSlot[]
    expect([...slots].sort()).toEqual(['brand_hero', 'brand_logo', 'link_image'])
  })
})
