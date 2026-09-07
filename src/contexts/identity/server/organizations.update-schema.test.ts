import { describe, expect, it } from 'vitest'
import { updateOrganizationInputSchema } from './organizations.update'

describe('updateOrganizationInputSchema beta contract', () => {
  it('retains active identity and logo settings', () => {
    expect(
      updateOrganizationInputSchema.safeParse({
        name: 'Meridian Hotels',
        logo: null,
      }).success,
    ).toBe(true)
  })
})
