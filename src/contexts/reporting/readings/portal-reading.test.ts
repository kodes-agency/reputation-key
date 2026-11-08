import { describe, expect, it } from 'vitest'
import { validatePortalReading } from './contracts'

describe('Portal fact validation', () => {
  it.each([1, 2, 3, 4, 5])('accepts %i whole private stars', (value) => {
    expect(validatePortalReading({ metricKey: 'portal.rating', value })).toBe(true)
  })
  it.each(['portal.qualified_scan', 'portal.feedback'])(
    'accepts a unit %s fact',
    (metricKey) => {
      expect(validatePortalReading({ metricKey, value: 1 })).toBe(true)
    },
  )
  it.each([
    'portal.scan',
    'portal.rating_count',
    'portal.rating_average',
    'property.review',
  ])('leaves %s to its own governed policy', (metricKey) => {
    expect(validatePortalReading({ metricKey, value: 1 })).toBe(false)
  })
  it.each(['google_review', 'secondary_link'] as const)(
    'preserves %s destination validation',
    (destinationKind) => {
      expect(
        validatePortalReading({
          metricKey: 'portal.review_link_click',
          value: 1,
          destinationKind,
        }),
      ).toBe(true)
    },
  )
  it.each([
    { metricKey: 'portal.qualified_scan', value: 2 },
    {
      metricKey: 'portal.qualified_scan',
      value: 1,
      destinationKind: 'google_review' as const,
    },
    { metricKey: 'portal.rating', value: 0 },
    { metricKey: 'portal.rating', value: 4.5 },
    { metricKey: 'portal.rating', value: 4, destinationKind: 'secondary_link' as const },
    { metricKey: 'portal.feedback', value: 0 },
    { metricKey: 'portal.feedback', value: 1, destinationKind: 'google_review' as const },
    {
      metricKey: 'portal.review_link_click',
      value: 2,
      destinationKind: 'google_review' as const,
    },
    { metricKey: 'portal.review_link_click', value: 1 },
  ])('rejects malformed Guest facts: $metricKey / $value', (input) => {
    expect(() => validatePortalReading(input)).toThrow('Portal metric fact is invalid')
  })
})
