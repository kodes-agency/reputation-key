import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }))

vi.mock('#/shared/auth/auth.functions', () => ({ getSession }))
vi.mock('#/contexts/identity/server/organizations', () => ({
  listUserInvitations: vi.fn(),
  acceptInvitation: vi.fn(),
}))

import { acceptInvitationSearch, Route } from './accept-invitation'

const INVITATION_ID = 'b3c1f0de-4a52-4d7e-9f61-2f1c7a9e5d10'

// The emailed link names one invitation (`?id=`). The router parses the query
// before the route sees it: a repeated key arrives as an array, and a bare
// number or `true` as that type. Each reads as "no invitation", the pending
// list, rather than reaching the page typed as a string it is not. The server
// takes any non-empty string (acceptInvitationInputSchema), so this does too.
describe('accept-invitation search', () => {
  it('keeps the invitation id the email names', () => {
    expect(acceptInvitationSearch.parse({ id: INVITATION_ID })).toEqual({
      id: INVITATION_ID,
    })
  })

  it.each([[['a', 'b']], [123], [true], [''], [{}]])(
    'reads id=%j as no invitation',
    (id) => {
      expect(acceptInvitationSearch.parse({ id }).id).toBeUndefined()
    },
  )

  it('reads a link without an id as no invitation', () => {
    expect(acceptInvitationSearch.parse({})).toEqual({})
  })
})

describe('accept-invitation route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends a signed-out visitor to join with the validated invitation id', async () => {
    getSession.mockResolvedValue(null)
    const beforeLoad = Route.options.beforeLoad
    if (!beforeLoad) throw new Error('accept-invitation must define beforeLoad')

    await expect(
      beforeLoad({
        search: { id: INVITATION_ID },
        location: { href: `/accept-invitation?id=${INVITATION_ID}` },
      } as never),
    ).rejects.toMatchObject({
      options: { to: '/join', search: { invitationId: INVITATION_ID } },
    })
  })

  it('sends a signed-out visitor with a malformed id to join without one', async () => {
    getSession.mockResolvedValue(null)
    const beforeLoad = Route.options.beforeLoad
    if (!beforeLoad) throw new Error('accept-invitation must define beforeLoad')

    // `?id=a&id=b`: validation already reduced it to no id.
    await expect(
      beforeLoad({
        search: { id: undefined },
        location: { href: '/accept-invitation?id=a&id=b' },
      } as never),
    ).rejects.toMatchObject({
      options: { to: '/join', search: { invitationId: undefined } },
    })
  })
})
