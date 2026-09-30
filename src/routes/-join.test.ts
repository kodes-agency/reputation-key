import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import { INVITATION_ID_MAX_LENGTH } from '#/shared/domain/ids'

const { getSession, getInvitationPreview } = vi.hoisted(() => ({
  getSession: vi.fn(),
  getInvitationPreview: vi.fn(),
}))

vi.mock('#/shared/auth/auth.functions', () => ({ getSession, ensureActiveOrg: vi.fn() }))
vi.mock('#/contexts/identity/server/organizations', () => ({
  registerMember: vi.fn(),
  listUserInvitations: vi.fn(),
  getInvitationPreview,
}))

import { joinSearch, Route } from './join'
import { enterWorkspace } from './-join-entry'

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

  // The preview refuses an id longer than INVITATION_ID_MAX_LENGTH. A link
  // whose id is longer than any id we issue is not an invitation, so it reads
  // as none (the Invitation required card) instead of reaching the server to
  // be refused there.
  it('keeps an id at the longest length the server accepts', () => {
    const invitationId = 'a'.repeat(INVITATION_ID_MAX_LENGTH)
    expect(joinSearch.parse({ invitationId }).invitationId).toBe(invitationId)
  })

  it('reads an id longer than the server accepts as no invitation', () => {
    const invitationId = 'a'.repeat(INVITATION_ID_MAX_LENGTH + 1)
    expect(joinSearch.parse({ invitationId }).invitationId).toBeUndefined()
  })
})

const EXPIRES_AT = new Date('2026-10-07T12:00:00.000Z')

const pendingPreview = (accountExists: boolean) => ({
  state: 'pending' as const,
  invitationId: INVITATION_ID,
  organizationName: 'Meridian Hotels',
  inviterName: 'Dana Whitfield',
  role: 'PropertyManager' as const,
  propertyNames: ['Hotel A', 'Hotel B'],
  email: 'new.hire@meridian.test',
  expiresAt: EXPIRES_AT,
  accountExists,
})

function runBeforeLoad(invitationId: string | undefined) {
  const beforeLoad = Route.options.beforeLoad
  if (!beforeLoad) throw new Error('join must define beforeLoad')
  return beforeLoad({ search: { invitationId } } as never)
}

describe('join route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSession.mockResolvedValue(null)
  })

  it('asks for an invitation when the link names none, without a preview read', async () => {
    await expect(runBeforeLoad(undefined)).resolves.toEqual({ link: null })
    expect(getInvitationPreview).not.toHaveBeenCalled()
  })

  it('sends a signed-in visitor with no invitation into the app', async () => {
    getSession.mockResolvedValue({ user: { email: 'dana@meridian.test' } })

    await expect(runBeforeLoad(undefined)).rejects.toMatchObject({
      options: { to: '/properties' },
    })
  })

  it('offers sign-up for a pending invitation, with what it grants', async () => {
    getInvitationPreview.mockResolvedValue(pendingPreview(false))

    await expect(runBeforeLoad(INVITATION_ID)).resolves.toEqual({
      link: {
        state: 'pending',
        invitationId: INVITATION_ID,
        invitedEmail: 'new.hire@meridian.test',
        details: {
          organizationName: 'Meridian Hotels',
          inviterName: 'Dana Whitfield',
          role: 'PropertyManager',
          propertyNames: ['Hotel A', 'Hotel B'],
          expiresAt: EXPIRES_AT,
        },
      },
    })
  })

  it('sends an address that already has an account to sign in, then back to the link', async () => {
    getInvitationPreview.mockResolvedValue(pendingPreview(true))

    await expect(runBeforeLoad(INVITATION_ID)).rejects.toMatchObject({
      options: {
        to: '/login',
        search: { redirect: `/accept-invitation?id=${INVITATION_ID}` },
      },
    })
  })

  it('sends a signed-in visitor to confirm the invitation instead of signing up', async () => {
    getSession.mockResolvedValue({ user: { email: 'dana@meridian.test' } })
    getInvitationPreview.mockResolvedValue(pendingPreview(false))

    await expect(runBeforeLoad(INVITATION_ID)).rejects.toMatchObject({
      options: { to: '/accept-invitation', search: { id: INVITATION_ID } },
    })
  })

  it.each(['expired', 'canceled', 'accepted'] as const)(
    'shows a %s invitation rather than a sign-up form',
    async (state) => {
      getInvitationPreview.mockResolvedValue({
        state,
        organizationName: 'Meridian Hotels',
        inviterName: null,
      })

      await expect(runBeforeLoad(INVITATION_ID)).resolves.toEqual({
        link: { state, organizationName: 'Meridian Hotels', inviterName: null },
      })
    },
  )

  it('shows an unknown invitation as unavailable', async () => {
    getInvitationPreview.mockResolvedValue({ state: 'unavailable' })

    await expect(runBeforeLoad(INVITATION_ID)).resolves.toEqual({
      link: { state: 'unavailable' },
    })
  })

  // Every open of a link spends some of the anonymous preview's per-IP budget,
  // so running out is an expected state. It says to wait, instead of the
  // generic error page (which offers Try again, and each retry spends more of
  // the same budget).
  it('says to wait when the preview is rate limited', async () => {
    getInvitationPreview.mockRejectedValue(
      new ServerFunctionError(
        'AuthError',
        'Too many requests. Try again later.',
        'rate_limited',
        429,
      ),
    )

    await expect(runBeforeLoad(INVITATION_ID)).resolves.toEqual({
      link: { state: 'rate_limited' },
    })
  })

  it('lets any other preview failure reach the error page', async () => {
    const failure = new ServerFunctionError('InternalError', 'Failed', 'internal', 500)
    getInvitationPreview.mockRejectedValue(failure)

    await expect(runBeforeLoad(INVITATION_ID)).rejects.toBe(failure)
  })
})

// After registration the member is signed in; the last step makes their
// Organization active and moves them into the app. If it fails, the card
// offers a retry that runs the same two steps again.
describe('entering the workspace after registration', () => {
  it('makes the Organization active, then navigates', async () => {
    const order: string[] = []

    await enterWorkspace({
      ensureActiveOrg: async () => void order.push('ensureActiveOrg'),
      navigateToWorkspace: async () => void order.push('navigate'),
    })

    expect(order).toEqual(['ensureActiveOrg', 'navigate'])
  })

  it('does not navigate when making the Organization active fails', async () => {
    const navigateToWorkspace = vi.fn()

    await expect(
      enterWorkspace({
        ensureActiveOrg: () => Promise.reject(new Error('active org unavailable')),
        navigateToWorkspace,
      }),
    ).rejects.toThrow('active org unavailable')

    expect(navigateToWorkspace).not.toHaveBeenCalled()
  })

  it('re-runs both steps on a retry after a failure', async () => {
    const ensureActiveOrg = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('active org unavailable'))
      .mockResolvedValue(undefined)
    const navigateToWorkspace = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    const steps = { ensureActiveOrg, navigateToWorkspace }

    await expect(enterWorkspace(steps)).rejects.toThrow('active org unavailable')
    await enterWorkspace(steps)

    expect(ensureActiveOrg).toHaveBeenCalledTimes(2)
    expect(navigateToWorkspace).toHaveBeenCalledTimes(1)
  })
})
