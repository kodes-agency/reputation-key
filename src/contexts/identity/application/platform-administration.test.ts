import { describe, expect, it } from 'vitest'
import { invitationId, organizationId } from '#/shared/domain/ids'
import type {
  OrganizationAdministration,
  PlatformOrganizationRow,
} from './ports/platform-organization-store.port'
import {
  assertOperatorMayAdminister,
  readPermittedInvitation,
  toPlatformOrganizationView,
} from './platform-administration'

const NOW = new Date('2026-09-30T12:00:00.000Z')

const ownerless: OrganizationAdministration = {
  organizationId: organizationId('org-new'),
  name: 'Hotel Riviera',
  lifecycleState: 'active',
  accountAdminCount: 0,
  openAdminInvitationIds: [invitationId('inv-open')],
}

const refusal = (code: string, message?: RegExp) =>
  expect.objectContaining({
    _tag: 'IdentityError',
    code,
    ...(message ? { message: expect.stringMatching(message) } : {}),
  })

describe('assertOperatorMayAdminister', () => {
  it('lets the console act on an active Organization with no AccountAdmin', () => {
    expect(() =>
      assertOperatorMayAdminister(ownerless, { requireActive: true }),
    ).not.toThrow()
  })

  it('refuses an Organization that does not exist', () => {
    expect(() => assertOperatorMayAdminister(null, { requireActive: false })).toThrow(
      refusal('forbidden'),
    )
  })

  it('refuses an Organization that already has an AccountAdmin', () => {
    expect(() =>
      assertOperatorMayAdminister(
        { ...ownerless, accountAdminCount: 1 },
        { requireActive: false },
      ),
    ).toThrow(refusal('forbidden', /already has an Account Admin/))
  })

  it('refuses an invitation on a non-active Organization but still lets it cancel', () => {
    const closing = { ...ownerless, lifecycleState: 'closure_requested' as const }

    expect(() => assertOperatorMayAdminister(closing, { requireActive: true })).toThrow(
      refusal('forbidden', /not active/),
    )
    expect(() =>
      assertOperatorMayAdminister(closing, {
        requireActive: false,
        invitationId: invitationId('inv-open'),
      }),
    ).not.toThrow()
  })

  it('touches only the open AccountAdmin invitations of that Organization', () => {
    expect(() =>
      assertOperatorMayAdminister(ownerless, {
        requireActive: true,
        invitationId: invitationId('inv-elsewhere'),
      }),
    ).toThrow(refusal('invitation_not_found'))
  })
})

describe('readPermittedInvitation', () => {
  const input = { organizationId: 'org-new', invitationId: 'inv-open' }
  const storeReading = (administration: OrganizationAdministration | null) => ({
    readAdministration: async () => administration,
  })

  it('returns the Organization and the invitation the console may act on', async () => {
    await expect(
      readPermittedInvitation(storeReading(ownerless), input, { requireActive: true }),
    ).resolves.toEqual({
      organizationId: organizationId('org-new'),
      invitationId: invitationId('inv-open'),
      administration: ownerless,
    })
  })

  it('refuses an invitation that is not one of the Organization open ones', async () => {
    await expect(
      readPermittedInvitation(
        storeReading(ownerless),
        { ...input, invitationId: 'inv-elsewhere' },
        { requireActive: true },
      ),
    ).rejects.toEqual(refusal('invitation_not_found'))
  })

  it('applies the active-Organization requirement it is given', async () => {
    const closing = { ...ownerless, lifecycleState: 'closure_requested' as const }

    await expect(
      readPermittedInvitation(storeReading(closing), input, { requireActive: true }),
    ).rejects.toEqual(refusal('forbidden', /not active/))
    await expect(
      readPermittedInvitation(storeReading(closing), input, { requireActive: false }),
    ).resolves.toMatchObject({ invitationId: invitationId('inv-open') })
  })
})

describe('toPlatformOrganizationView', () => {
  const row: PlatformOrganizationRow = {
    id: organizationId('org-new'),
    name: 'Hotel Riviera',
    slug: 'hotel-riviera',
    createdAt: new Date('2026-09-29T08:00:00.000Z'),
    lifecycleState: 'active',
    memberCount: 0,
    accountAdminCount: 0,
    pendingInvitationCount: 1,
    adminInvitations: [
      {
        id: invitationId('inv-live'),
        email: 'admin@riviera.example',
        status: 'pending',
        expiresAt: new Date('2026-10-06T12:00:00.000Z'),
      },
      {
        id: invitationId('inv-lapsed'),
        email: 'old@riviera.example',
        status: 'pending',
        expiresAt: new Date('2026-09-30T12:00:00.000Z'),
      },
      {
        id: invitationId('inv-marked'),
        email: 'marked@riviera.example',
        status: 'expired',
        expiresAt: new Date('2026-10-02T12:00:00.000Z'),
      },
    ],
  }

  it('serializes the row and reads each admin invitation as live or expired', () => {
    expect(toPlatformOrganizationView(row, false, NOW)).toEqual({
      id: 'org-new',
      name: 'Hotel Riviera',
      slug: 'hotel-riviera',
      createdAt: '2026-09-29T08:00:00.000Z',
      lifecycleState: 'active',
      memberCount: 0,
      accountAdminCount: 0,
      pendingInvitationCount: 1,
      controlledBetaEnabled: false,
      pendingAdminInvitations: [
        {
          id: 'inv-live',
          email: 'admin@riviera.example',
          expiresAt: '2026-10-06T12:00:00.000Z',
          expired: false,
        },
        {
          id: 'inv-lapsed',
          email: 'old@riviera.example',
          expiresAt: '2026-09-30T12:00:00.000Z',
          expired: true,
        },
        {
          id: 'inv-marked',
          email: 'marked@riviera.example',
          expiresAt: '2026-10-02T12:00:00.000Z',
          expired: true,
        },
      ],
    })
  })

  it('shows no invitee addresses once the Organization has an AccountAdmin', () => {
    const view = toPlatformOrganizationView(
      { ...row, memberCount: 1, accountAdminCount: 1 },
      true,
      NOW,
    )

    expect(view.pendingAdminInvitations).toEqual([])
    expect(view.controlledBetaEnabled).toBe(true)
  })
})
