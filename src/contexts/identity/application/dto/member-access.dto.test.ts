import { describe, expect, it } from 'vitest'
import { setMemberPropertyAccessInputSchema } from './member-access.dto'

const PROPERTY_A = '00000000-0000-4000-8000-00000000000a'
const PROPERTY_B = '00000000-0000-4000-8000-00000000000b'

describe('setMemberPropertyAccessInputSchema', () => {
  it('accepts grants and revokes, defaulting a missing list to none', () => {
    expect(
      setMemberPropertyAccessInputSchema.parse({
        memberId: 'member-1',
        grantPropertyIds: [PROPERTY_A],
      }),
    ).toEqual({
      memberId: 'member-1',
      grantPropertyIds: [PROPERTY_A],
      revokePropertyIds: [],
    })
    expect(
      setMemberPropertyAccessInputSchema.safeParse({
        memberId: 'member-1',
        grantPropertyIds: [PROPERTY_A],
        revokePropertyIds: [PROPERTY_B],
      }).success,
    ).toBe(true)
  })

  it('refuses a request that changes nothing', () => {
    expect(
      setMemberPropertyAccessInputSchema.safeParse({ memberId: 'member-1' }).success,
    ).toBe(false)
    expect(
      setMemberPropertyAccessInputSchema.safeParse({
        memberId: 'member-1',
        grantPropertyIds: [],
        revokePropertyIds: [],
      }).success,
    ).toBe(false)
  })

  it('refuses granting and revoking the same Property at once', () => {
    expect(
      setMemberPropertyAccessInputSchema.safeParse({
        memberId: 'member-1',
        grantPropertyIds: [PROPERTY_A],
        revokePropertyIds: [PROPERTY_A],
      }).success,
    ).toBe(false)
  })

  it.each([
    ['a missing member', { grantPropertyIds: [PROPERTY_A] }],
    ['an empty member', { memberId: '', grantPropertyIds: [PROPERTY_A] }],
    ['a non-UUID Property', { memberId: 'member-1', grantPropertyIds: ['property-1'] }],
    [
      'more than 200 Properties',
      {
        memberId: 'member-1',
        revokePropertyIds: Array.from(
          { length: 201 },
          (_, index) => `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`,
        ),
      },
    ],
  ])('refuses %s', (_label, input) => {
    expect(setMemberPropertyAccessInputSchema.safeParse(input).success).toBe(false)
  })
})
