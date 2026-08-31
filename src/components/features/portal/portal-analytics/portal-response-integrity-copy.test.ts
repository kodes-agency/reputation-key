import { describe, expect, it } from 'vitest'
import { portalResponseIntegrityCopy } from './portal-response-integrity-copy'

describe('portalResponseIntegrityCopy', () => {
  it('uses Portal responses rather than claiming unique guests', () => {
    const copy = portalResponseIntegrityCopy({
      accepted: 8,
      filteredAutomatically: 1,
      underReview: 1,
      total: 10,
    })

    expect(copy).toBe(
      '2 Portal responses are currently outside the private-rating figures while quality checks are resolved.',
    )
    expect(copy.toLowerCase()).not.toContain('unique guest')
  })

  it('uses gentle singular and zero-result copy', () => {
    expect(
      portalResponseIntegrityCopy({
        accepted: 4,
        filteredAutomatically: 0,
        underReview: 1,
        total: 5,
      }),
    ).toContain('1 Portal response is currently outside')
    expect(
      portalResponseIntegrityCopy({
        accepted: 4,
        filteredAutomatically: 0,
        underReview: 0,
        total: 4,
      }),
    ).toBe('No Portal responses in this period are outside the private-rating figures.')
  })
})
