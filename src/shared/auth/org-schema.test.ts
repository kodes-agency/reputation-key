import { describe, expect, it } from 'vitest'
import { organizationSchema } from './org-schema'

describe('Better Auth organization input surface', () => {
  it('keeps dormant billing storage out of both input and responses', () => {
    const fields = organizationSchema.organization.additionalFields

    expect(fields.contactEmail).toMatchObject({ input: true })
    expect(fields.responseSlaHours).toMatchObject({ input: true })
    for (const field of [
      fields.billingCompanyName,
      fields.billingAddress,
      fields.billingCity,
      fields.billingPostalCode,
      fields.billingCountry,
    ]) {
      expect(field).toMatchObject({ input: false, returned: false })
    }
  })
})
