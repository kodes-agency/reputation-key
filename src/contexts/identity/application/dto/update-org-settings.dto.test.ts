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
})
