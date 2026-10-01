import { describe, expect, it } from 'vitest'
import {
  LINK_ICON_CHOICES,
  LINK_ICONS,
  linkIconKeyOrDefault,
  linkIconLabel,
} from './link-icons'
import { PORTAL_LINK_ICON_KEYS } from '#/shared/domain/portal-link-icon'

describe('link icons', () => {
  it('draws every key of the closed catalogue, and only those', () => {
    expect(Object.keys(LINK_ICONS).sort()).toEqual([...PORTAL_LINK_ICON_KEYS].sort())
    expect(LINK_ICON_CHOICES).toEqual(PORTAL_LINK_ICON_KEYS)
  })

  it('falls back to the plain link icon for no icon or an unknown one', () => {
    expect(linkIconKeyOrDefault(null)).toBe('link')
    expect(linkIconKeyOrDefault('rocket')).toBe('link')
    expect(linkIconKeyOrDefault('utensils')).toBe('utensils')
  })

  it('names a choice in words', () => {
    expect(linkIconLabel('bed-double')).toBe('Bed double')
    expect(linkIconLabel('wifi')).toBe('Wifi')
  })
})
