import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getSession, getInvitationPreview } = vi.hoisted(() => ({
  getSession: vi.fn(),
  getInvitationPreview: vi.fn(),
}))

vi.mock('#/shared/auth/auth.functions', () => ({ getSession }))
vi.mock('#/contexts/identity/server/organizations', () => ({
  listUserInvitations: vi.fn(),
  acceptInvitation: vi.fn(),
  getInvitationPreview,
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

const EXPIRES_AT = new Date('2026-10-07T12:00:00.000Z')

const pendingPreview = (accountExists: boolean) => ({
  state: 'pending' as const,
  invitationId: INVITATION_ID,
  organizationName: 'Meridian Hotels',
  inviterName: 'Dana Whitfield',
  role: 'PropertyManager' as const,
  propertyNames: ['Hotel A'],
  email: 'new.hire@meridian.test',
  expiresAt: EXPIRES_AT,
  accountExists,
})

const signedInAs = (email: string) => ({ user: { email }, session: {} })

function runBeforeLoad(id: string | undefined) {
  const beforeLoad = Route.options.beforeLoad
  if (!beforeLoad) throw new Error('accept-invitation must define beforeLoad')
  return beforeLoad({
    search: { id },
    location: { href: `/accept-invitation?id=${id ?? ''}` },
  } as never)
}

describe('accept-invitation route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('without an invitation id', () => {
    it('sends a signed-out visitor to join, which asks for an invitation', async () => {
      getSession.mockResolvedValue(null)

      // `?id=a&id=b`: validation already reduced it to no id.
      await expect(runBeforeLoad(undefined)).rejects.toMatchObject({
        options: { to: '/join', search: { invitationId: undefined } },
      })
      expect(getInvitationPreview).not.toHaveBeenCalled()
    })

    it('keeps the pending list for a signed-in visitor', async () => {
      getSession.mockResolvedValue(signedInAs('dana@meridian.test'))

      await expect(runBeforeLoad(undefined)).resolves.toEqual({
        entry: { kind: 'list' },
      })
      expect(getInvitationPreview).not.toHaveBeenCalled()
    })
  })

  describe('signed out, with an invitation id', () => {
    beforeEach(() => getSession.mockResolvedValue(null))

    it('sends an address with no account to create one on join', async () => {
      getInvitationPreview.mockResolvedValue(pendingPreview(false))

      await expect(runBeforeLoad(INVITATION_ID)).rejects.toMatchObject({
        options: { to: '/join', search: { invitationId: INVITATION_ID } },
      })
    })

    it('sends an address that has an account to sign in, then back to the link', async () => {
      getInvitationPreview.mockResolvedValue(pendingPreview(true))

      await expect(runBeforeLoad(INVITATION_ID)).rejects.toMatchObject({
        options: {
          to: '/login',
          search: { redirect: `/accept-invitation?id=${INVITATION_ID}` },
        },
      })
    })

    it.each(['expired', 'canceled', 'accepted'] as const)(
      'shows a %s invitation as it is, with no sign-up or sign-in first',
      async (state) => {
        getInvitationPreview.mockResolvedValue({
          state,
          organizationName: 'Meridian Hotels',
          inviterName: 'Dana Whitfield',
        })

        await expect(runBeforeLoad(INVITATION_ID)).resolves.toEqual({
          entry: {
            kind: 'unusable',
            link: {
              state,
              organizationName: 'Meridian Hotels',
              inviterName: 'Dana Whitfield',
            },
          },
        })
      },
    )

    it('shows an unknown invitation the same way', async () => {
      getInvitationPreview.mockResolvedValue({ state: 'unavailable' })

      await expect(runBeforeLoad(INVITATION_ID)).resolves.toEqual({
        entry: { kind: 'unusable', link: { state: 'unavailable' } },
      })
    })
  })

  describe('signed in, with an invitation id', () => {
    it('hands the page the invitation and the signed-in address, and accepts nothing', async () => {
      getSession.mockResolvedValue(signedInAs('new.hire@meridian.test'))
      getInvitationPreview.mockResolvedValue(pendingPreview(true))

      await expect(runBeforeLoad(INVITATION_ID)).resolves.toEqual({
        entry: {
          kind: 'link',
          signedInEmail: 'new.hire@meridian.test',
          link: {
            state: 'pending',
            invitationId: INVITATION_ID,
            invitedEmail: 'new.hire@meridian.test',
            details: {
              organizationName: 'Meridian Hotels',
              inviterName: 'Dana Whitfield',
              role: 'PropertyManager',
              propertyNames: ['Hotel A'],
              expiresAt: EXPIRES_AT,
            },
          },
        },
      })
    })

    it('still shows a signed-in visitor a used link instead of the list', async () => {
      getSession.mockResolvedValue(signedInAs('new.hire@meridian.test'))
      getInvitationPreview.mockResolvedValue({
        state: 'accepted',
        organizationName: 'Meridian Hotels',
        inviterName: null,
      })

      await expect(runBeforeLoad(INVITATION_ID)).resolves.toMatchObject({
        entry: { kind: 'link', link: { state: 'accepted' } },
      })
    })
  })
})
