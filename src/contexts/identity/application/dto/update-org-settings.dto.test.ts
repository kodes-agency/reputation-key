import { describe, expect, it } from 'vitest'
import { updateOrgSettingsSchema } from './update-org-settings.dto'

const identityUpdate = {
  name: 'Meridian Hotels',
  slug: 'meridian-hotels',
  contactEmail: 'operations@meridian.example',
}

describe('updateOrgSettingsSchema beta contract', () => {
  it('accepts organization identity fields', () => {
    expect(updateOrgSettingsSchema.parse(identityUpdate)).toEqual(identityUpdate)
  })

  it('rejects dormant billing fields instead of silently stripping them', () => {
    expect(() =>
      updateOrgSettingsSchema.parse({
        ...identityUpdate,
        billingCompanyName: 'Meridian Holdings',
      }),
    ).toThrow()
  })
})
