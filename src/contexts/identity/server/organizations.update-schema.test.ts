import { describe, expect, it } from 'vitest'
import { updateOrganizationInputSchema } from './organizations.update'

describe('updateOrganizationInputSchema beta contract', () => {
  it('rejects attempts to write dormant billing metadata', () => {
    const result = updateOrganizationInputSchema.safeParse({
      billingAddress: '100 Market Street',
    })

    expect(result.success).toBe(false)
  })

  it('retains active identity, logo, and response settings', () => {
    expect(
      updateOrganizationInputSchema.safeParse({
        name: 'Meridian Hotels',
        logo: null,
        responseSlaHours: 24,
      }).success,
    ).toBe(true)
  })
})
