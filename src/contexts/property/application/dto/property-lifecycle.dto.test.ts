import { describe, expect, it } from 'vitest'
import {
  archivePropertyInputSchema,
  propertyLifecycleTargetSchema,
} from './property-lifecycle.dto'

describe('Property lifecycle command input', () => {
  it('normalizes a bounded archive reason', () => {
    expect(
      archivePropertyInputSchema.parse({
        propertyId: 'property-1',
        reason: '  Property no longer trading  ',
      }),
    ).toEqual({
      propertyId: 'property-1',
      reason: 'Property no longer trading',
    })
  })

  it('rejects empty identifiers and archive reasons outside 3..500 characters', () => {
    expect(propertyLifecycleTargetSchema.safeParse({ propertyId: '' }).success).toBe(
      false,
    )
    expect(
      archivePropertyInputSchema.safeParse({ propertyId: 'property-1', reason: '  ' })
        .success,
    ).toBe(false)
    expect(
      archivePropertyInputSchema.safeParse({
        propertyId: 'property-1',
        reason: 'x'.repeat(501),
      }).success,
    ).toBe(false)
  })
})
