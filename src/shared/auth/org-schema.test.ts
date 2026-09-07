import { describe, expect, it } from 'vitest'
import { organizationSchema } from './org-schema'

describe('Better Auth organization input surface', () => {
  it('publishes contact email as the only custom organization field', () => {
    expect(organizationSchema.organization.additionalFields).toEqual({
      contactEmail: {
        type: 'string',
        input: true,
        required: false,
      },
    })
  })
})
