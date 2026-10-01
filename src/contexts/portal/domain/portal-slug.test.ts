import { describe, expect, it } from 'vitest'
import { SLUG_PATTERN } from '#/shared/domain/slug'
import { MAX_SLUG_SUFFIX_ATTEMPTS, slugWithSuffix } from './portal-slug'

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
