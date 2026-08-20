import { describe, expect, it } from 'vitest'
import {
  getPropertyGooglePerformanceInputSchema,
  renewPropertyGooglePerformanceLeaseInputSchema,
} from './google-performance.dto'

const PROPERTY_ID = '11111111-1111-4111-8111-111111111111'

describe('getPropertyGooglePerformanceInputSchema', () => {
  it.each(['7d', '30d', '90d', '180d'] as const)(
    'accepts the bounded %s preset',
    (preset) => {
      expect(
        getPropertyGooglePerformanceInputSchema.safeParse({
          propertyId: PROPERTY_ID,
          preset,
        }).success,
      ).toBe(true)
    },
  )

  it('rejects invalid ranges, identifiers, and unknown fields', () => {
    expect(
      getPropertyGooglePerformanceInputSchema.safeParse({
        propertyId: PROPERTY_ID,
        preset: '60d',
      }).success,
    ).toBe(false)
    expect(
      getPropertyGooglePerformanceInputSchema.safeParse({
        propertyId: 'property-1',
        preset: '30d',
      }).success,
    ).toBe(false)
    expect(
      getPropertyGooglePerformanceInputSchema.safeParse({
        propertyId: PROPERTY_ID,
        preset: '30d',
        providerLocationId: 'must-not-cross-boundary',
      }).success,
    ).toBe(false)
  })
})

describe('renewPropertyGooglePerformanceLeaseInputSchema', () => {
  it('accepts only a property and opaque lease reference', () => {
    expect(
      renewPropertyGooglePerformanceLeaseInputSchema.safeParse({
        propertyId: PROPERTY_ID,
        leaseRef: 'v1.opaque-lease',
      }).success,
    ).toBe(true)
    expect(
      renewPropertyGooglePerformanceLeaseInputSchema.safeParse({
        propertyId: PROPERTY_ID,
        leaseRef: 'v1.opaque-lease',
        connectionId: 'must-not-cross-boundary',
      }).success,
    ).toBe(false)
  })
})
