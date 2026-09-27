import { describe, expect, it, vi } from 'vitest'

vi.mock('#/shared/auth/auth.functions', () => ({ getSession: vi.fn() }))
vi.mock('#/contexts/identity/server/organizations', () => ({
  registerMember: vi.fn(),
}))

import { joinSearch } from './join'

const INVITATION_ID = 'b3c1f0de-4a52-4d7e-9f61-2f1c7a9e5d10'

// Join creates an account from one invitation (`?invitationId=`). The router
// parses the query before the route sees it: a repeated key arrives as an
// array, and a bare number or `true` as that type. Each reads as "no
// invitation", the Invitation required card, rather than a hidden form field
// the register schema then refuses without a word. The server takes any
// non-empty string (registerMemberInputSchema), so this does too.
describe('join search', () => {
  it('keeps the invitation id the link names', () => {
    expect(joinSearch.parse({ invitationId: INVITATION_ID })).toEqual({
      invitationId: INVITATION_ID,
    })
  })

  it.each([[['a', 'b']], [123], [true], [''], [{}]])(
    'reads invitationId=%j as no invitation',
    (invitationId) => {
      expect(joinSearch.parse({ invitationId }).invitationId).toBeUndefined()
    },
  )

  it('reads a link without an invitation id as no invitation', () => {
    expect(joinSearch.parse({})).toEqual({})
  })
})
