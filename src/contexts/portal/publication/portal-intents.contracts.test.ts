import { describe, expect, it } from 'vitest'
import { updatePortalSettingsInputSchema } from './portal-intents.contracts'

describe('updatePortalSettingsInputSchema', () => {
  it('refuses a caller-supplied hero image URL', () => {
    const parsed = updatePortalSettingsInputSchema.safeParse({
      portalId: 'portal-1',
      heroImageUrl: 'https://cdn.example.com/new.jpg',
    })

    expect(parsed.success).toBe(false)
  })

  it('accepts clearing the hero image', () => {
    const parsed = updatePortalSettingsInputSchema.safeParse({
      portalId: 'portal-1',
      heroImageUrl: null,
    })

    expect(parsed.success).toBe(true)
  })

  it('refuses a skip flag that is not a boolean', () => {
    const parsed = updatePortalSettingsInputSchema.safeParse({
      portalId: 'portal-1',
      skipPrivateRating: 'yes',
    })

    expect(parsed.success).toBe(false)
  })
})
