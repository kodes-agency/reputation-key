import { describe, expect, it } from 'vitest'
import { updateOrganizationInputSchema } from './organizations.update'

const ASSET = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'

describe('updateOrganizationInputSchema beta contract', () => {
  it('retains active identity and logo settings', () => {
    expect(
      updateOrganizationInputSchema.safeParse({
        name: 'Meridian Hotels',
        logo: null,
      }).success,
    ).toBe(true)
  })

  // An uploaded logo is saved by its finalize step, which holds the key to the
  // Organization and reads the size the store holds. This function took the
  // same address with neither check, so the finalize step could be skipped.
  it.each([
    `/api/public/identity-assets/organizations/org-1/logo/${ASSET}`,
    `/api/public/identity-assets/organizations/another-org/logo/${ASSET}`,
    `/api/public/identity-assets/avatars/user-1/${ASSET}`,
  ])('refuses the address of an uploaded picture: %s', (logo) => {
    const parsed = updateOrganizationInputSchema.safeParse({ logo })

    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues[0]).toMatchObject({
      path: ['logo'],
      message: 'An uploaded logo is saved by its upload.',
    })
  })

  it('still takes a logo hosted elsewhere, and an update that names no logo', () => {
    expect(
      updateOrganizationInputSchema.parse({ logo: 'https://cdn.example.com/logo.png' }),
    ).toMatchObject({ logo: 'https://cdn.example.com/logo.png' })
    expect(updateOrganizationInputSchema.parse({ name: 'Meridian Hotels' })).toEqual({
      name: 'Meridian Hotels',
    })
  })
})
