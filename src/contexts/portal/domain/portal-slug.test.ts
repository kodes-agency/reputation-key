import { describe, expect, it } from 'vitest'
import { SLUG_PATTERN } from '#/shared/domain/slug'
import {
  FALLBACK_SLUG_BASE,
  MAX_SLUG_SUFFIX_ATTEMPTS,
  hasUsablePortalAddress,
  idBasedPortalSlug,
  portalSlugBase,
  slugWithSuffix,
} from './portal-slug'

describe('slugWithSuffix', () => {
  it('keeps the base on the first attempt', () => {
    expect(slugWithSuffix('rooftop-pool', 1)).toBe('rooftop-pool')
  })

  it('appends the attempt number from the second attempt', () => {
    expect(slugWithSuffix('rooftop-pool', 2)).toBe('rooftop-pool-2')
    expect(slugWithSuffix('rooftop-pool', 13)).toBe('rooftop-pool-13')
  })

  it('shortens a base that has no room for the suffix, without a dangling hyphen', () => {
    const base = `${'a'.repeat(61)}-bc`
    expect(base).toHaveLength(64)
    const suffixed = slugWithSuffix(base, 10)
    expect(suffixed).toHaveLength(64)
    expect(suffixed.endsWith('-10')).toBe(true)
    expect(suffixed).not.toContain('--')
    expect(SLUG_PATTERN.test(suffixed)).toBe(true)
  })

  it('drops a hyphen left at the cut so the result stays a valid slug', () => {
    const base = `${'a'.repeat(61)}-x-y`
    const suffixed = slugWithSuffix(base, 2)
    expect(suffixed).not.toContain('--')
    expect(SLUG_PATTERN.test(suffixed)).toBe(true)
  })

  it('names a bounded number of attempts', () => {
    expect(MAX_SLUG_SUFFIX_ATTEMPTS).toBeGreaterThanOrEqual(10)
  })
})

describe('portalSlugBase', () => {
  it('derives the address from a Latin name', () => {
    expect(portalSlugBase('Rooftop pool')).toBe('rooftop-pool')
  })

  it.each(['Рецепция', 'Басейн на покрива', 'A', '☕☕', '   ', '---'])(
    'falls back to a fixed base when %j gives no usable address',
    (name) => {
      expect(portalSlugBase(name)).toBe(FALLBACK_SLUG_BASE)
      expect(SLUG_PATTERN.test(FALLBACK_SLUG_BASE)).toBe(true)
    },
  )

  it('keeps the Latin part of a mixed name that is long enough', () => {
    expect(portalSlugBase('Spa и сауна')).toBe('spa')
  })

  it('never ends in a hyphen left by the length cut', () => {
    const name = `${'a'.repeat(63)} bcd`
    const base = portalSlugBase(name)
    expect(SLUG_PATTERN.test(base)).toBe(true)
  })
})

describe('hasUsablePortalAddress', () => {
  it('is true for a name that stands for an address of its own', () => {
    expect(hasUsablePortalAddress('Rooftop pool')).toBe(true)
  })

  it.each(['Рецепция', 'A', '☕☕', '   '])('is false for %j', (name) => {
    expect(hasUsablePortalAddress(name)).toBe(false)
  })
})

describe('idBasedPortalSlug', () => {
  const id = 'd0a1b2c3-0000-4000-8000-000000000001'

  it('builds the address from the start of the Portal id', () => {
    expect(idBasedPortalSlug(id, 8)).toBe('portal-d0a1b2c3')
  })

  it('takes a longer slice on a later attempt, up to the whole id', () => {
    expect(idBasedPortalSlug(id, 12)).toBe('portal-d0a1b2c30000')
    expect(idBasedPortalSlug(id, 100)).toBe(`portal-${id.replaceAll('-', '')}`)
  })

  it('only ever yields a valid slug, whatever the id holds', () => {
    for (const odd of ['p-1', 'ID_WITH_Caps', '---']) {
      expect(SLUG_PATTERN.test(idBasedPortalSlug(odd, 8))).toBe(true)
    }
  })
})
