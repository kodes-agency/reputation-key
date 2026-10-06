import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import { identityKeys } from '#/shared/queries/query-keys'

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

import { invitationPreviewInputSchema } from '#/contexts/identity/application/dto/invitation.dto'
import { INVITATION_ID_MAX_LENGTH } from '#/shared/domain/ids'
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

  // The preview refuses an id longer than INVITATION_ID_MAX_LENGTH. A link
  // whose id is longer than any id we issue is not an invitation, so it reads
  // as none instead of reaching the server to be refused there.
  it('keeps an id at the longest length the server accepts', () => {
    const id = 'a'.repeat(INVITATION_ID_MAX_LENGTH)
    expect(acceptInvitationSearch.parse({ id }).id).toBe(id)
  })

  it('reads an id longer than the server accepts as no invitation', () => {
    const id = 'a'.repeat(INVITATION_ID_MAX_LENGTH + 1)
    expect(acceptInvitationSearch.parse({ id }).id).toBeUndefined()
    expect(invitationPreviewInputSchema.safeParse({ invitationId: id }).success).toBe(
      false,
    )
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

const ensureQueryData = vi.fn()

function runBeforeLoad(id: string | undefined) {
  const beforeLoad = Route.options.beforeLoad
  if (!beforeLoad) throw new Error('accept-invitation must define beforeLoad')
  return beforeLoad({
    search: { id },
    context: { queryClient: { ensureQueryData } },
    location: { href: `/accept-invitation?id=${id ?? ''}` },
  } as never)
}

// What the preview server function throws past its per-IP limit.
const rateLimited = () =>
  new ServerFunctionError(
    'AuthError',
    'Too many requests. Try again later.',
    'rate_limited',
    429,
  )

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

    // The list is primed where the page is chosen, not in a `loader`: a loader
    // would sit in the first-paint bundle, which is budgeted to the byte.
    it('primes the pending list for the page it chose', async () => {
      getSession.mockResolvedValue(signedInAs('dana@meridian.test'))

      await runBeforeLoad(undefined)

      expect(ensureQueryData).toHaveBeenCalledTimes(1)
      expect(ensureQueryData).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: identityKeys.userInvitations() }),
      )
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

    // Every open of a link spends some of the anonymous preview's per-IP
    // budget, so running out is an expected state. It says to wait, instead of
    // the generic error page (which offers Try again, and each retry spends
    // more of the same budget).
    it('says to wait when the preview is rate limited', async () => {
      getInvitationPreview.mockRejectedValue(rateLimited())

      await expect(runBeforeLoad(INVITATION_ID)).resolves.toEqual({
        entry: { kind: 'unusable', link: { state: 'rate_limited' } },
      })
    })

    it.each([
      [
        'a server error',
        new ServerFunctionError('InternalError', 'Failed', 'internal', 500),
      ],
      ['an error with no code', new Error('network down')],
    ])('does not mistake %s for a rate limit', async (_label, failure) => {
      getInvitationPreview.mockRejectedValue(failure)

      await expect(runBeforeLoad(INVITATION_ID)).rejects.toBe(failure)
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

    it('tells a signed-in visitor to wait when the preview is rate limited', async () => {
      getSession.mockResolvedValue(signedInAs('new.hire@meridian.test'))
      getInvitationPreview.mockRejectedValue(rateLimited())

      await expect(runBeforeLoad(INVITATION_ID)).resolves.toEqual({
        entry: {
          kind: 'link',
          signedInEmail: 'new.hire@meridian.test',
          link: { state: 'rate_limited' },
        },
      })
      expect(ensureQueryData).not.toHaveBeenCalled()
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
