import { describe, expect, it } from 'vitest'
import {
  deriveOrganizationSlug,
  ORGANIZATION_SLUG_DERIVED_MAX,
} from './organization-slug'

describe('deriveOrganizationSlug', () => {
  it('lowercases and joins every run of other characters with one hyphen', () => {
    expect(deriveOrganizationSlug('Hotel  Riviera & Spa!')).toBe('hotel-riviera-spa')
  })

  it('drops leading and trailing separators', () => {
    expect(deriveOrganizationSlug('  --The Grand-- ')).toBe('the-grand')
  })

  it('falls back to "organization" when nothing usable is left', () => {
    expect(deriveOrganizationSlug('')).toBe('organization')
    expect(deriveOrganizationSlug('★ ★ ★')).toBe('organization')
  })

  it('caps the slug at 60 characters without ending on a hyphen', () => {
    const name = `${'a'.repeat(59)} tail`
    const slug = deriveOrganizationSlug(name)

    expect(ORGANIZATION_SLUG_DERIVED_MAX).toBe(60)
    expect(slug).toBe('a'.repeat(59))
    expect(deriveOrganizationSlug('b'.repeat(80))).toHaveLength(60)
  })

  it('replaces letters outside a-z instead of transliterating them', () => {
    expect(deriveOrganizationSlug('Café Zürich')).toBe('caf-z-rich')
  })
})
