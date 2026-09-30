import { describe, expect, it } from 'vitest'
import {
  PORTAL_LINK_ICON_KEYS,
  isPortalLinkIconKey,
  parsePortalLinkIconKey,
} from './portal-link-icon'

describe('portal link icon catalogue', () => {
  it('is a closed, duplicate-free list of lowercase kebab-case keys', () => {
    expect(new Set(PORTAL_LINK_ICON_KEYS).size).toBe(PORTAL_LINK_ICON_KEYS.length)
    for (const key of PORTAL_LINK_ICON_KEYS) {
      expect(key).toMatch(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)
      expect(key.length).toBeLessThanOrEqual(40)
    }
  })

  it('names the keys that existing fixtures and the seed already use', () => {
    for (const key of ['external-link', 'star', 'utensils']) {
      expect(isPortalLinkIconKey(key)).toBe(true)
    }
  })

  it('carries every icon the round-4 editor picker offers', () => {
    // Knife and fork, Open book, Waves, Map pin, Bed, Reception bell.
    for (const key of [
      'utensils',
      'book-open',
      'waves',
      'map-pin',
      'bed-double',
      'concierge-bell',
    ]) {
      expect(isPortalLinkIconKey(key)).toBe(true)
    }
  })

  it('recognises members and refuses everything else', () => {
    expect(isPortalLinkIconKey('map-pin')).toBe(true)
    expect(isPortalLinkIconKey('guide')).toBe(false)
    expect(isPortalLinkIconKey('')).toBe(false)
    expect(isPortalLinkIconKey(null)).toBe(false)
    expect(isPortalLinkIconKey(42)).toBe(false)
  })

  it('parses to a member or null, never a guess', () => {
    expect(parsePortalLinkIconKey('wifi')).toBe('wifi')
    expect(parsePortalLinkIconKey('not-an-icon')).toBeNull()
    expect(parsePortalLinkIconKey(undefined)).toBeNull()
  })
})
