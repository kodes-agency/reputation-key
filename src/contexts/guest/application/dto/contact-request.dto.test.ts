import { describe, expect, it } from 'vitest'
import { submitContactRequestInputSchema } from './contact-request.dto'

const BASE = Object.freeze({
  organizationId: 'org-1',
  propertyId: '10000000-0000-4000-8000-000000000002',
  portalId: '10000000-0000-4000-8000-000000000003',
  responseId: '10000000-0000-4000-8000-000000000004',
  email: 'guest@example.com',
})

describe('Contact Request input', () => {
  it('defaults consent to false and never infers purpose from contact data', () => {
    expect(submitContactRequestInputSchema.parse(BASE)).toEqual({
      ...BASE,
      consent: false,
    })
  })

  it('accepts only the approved email follow-up shape and excludes phone', () => {
    expect(
      submitContactRequestInputSchema.parse({
        ...BASE,
        name: '  Guest Name  ',
        consent: true,
        purpose: 'manager_follow_up',
      }),
    ).toEqual({
      ...BASE,
      name: 'Guest Name',
      consent: true,
      purpose: 'manager_follow_up',
    })
    expect(
      submitContactRequestInputSchema.safeParse({
        ...BASE,
        name: '   ',
        consent: true,
        purpose: 'manager_follow_up',
      }).success,
    ).toBe(false)
    expect(
      submitContactRequestInputSchema.safeParse({
        ...BASE,
        consent: true,
        purpose: 'manager_follow_up',
        phone: '+359000000000',
      }).success,
    ).toBe(false)
  })
})
