import { describe, expect, it, vi } from 'vitest'
import { invitationId, organizationId } from '#/shared/domain/ids'
import type { InvitedRegistrationStore } from '../ports/invited-registration-store.port'
import type { IdentityCommandStore } from '../ports/identity-command-store.port'
import { recoverInvitedRegistrations } from './recover-invited-registrations'

const NOW = new Date('2026-08-27T12:00:00.000Z')
const VERIFICATION_ID = '10000000-0000-4000-8000-000000000001'
const INVITATION_ID = invitationId('invitation-recovery-1')
const ORGANIZATION_ID = organizationId('organization-recovery-1')

function setup(
  results: ReadonlyArray<Awaited<ReturnType<InvitedRegistrationStore['reconcile']>>>,
) {
  const claimDue = vi.fn().mockResolvedValue([{ verificationId: VERIFICATION_ID }])
  const reconcile = vi.fn()
  for (const result of results) reconcile.mockResolvedValueOnce(result)
  const complete = vi.fn().mockResolvedValue(undefined)
  const acceptInvitation = vi.fn().mockResolvedValue({
    organizationId: ORGANIZATION_ID,
    propertyIds: ['property-1'],
  })
  const runOnAccepted = vi.fn().mockResolvedValue(undefined)
  const logger = { error: vi.fn() }
  const run = recoverInvitedRegistrations({
    registrationStore: {
      prepare: vi.fn(),
      claimDue,
      reconcile,
      complete,
    },
    commandStore: { acceptInvitation } as unknown as IdentityCommandStore,
    runOnAccepted,
    clock: () => NOW,
    logger,
  })
  return {
    run,
    claimDue,
    reconcile,
    acceptInvitation,
    complete,
    runOnAccepted,
    logger,
  }
}

describe('recoverInvitedRegistrations', () => {
  it('claims a bounded verification record and completes the exact registration', async () => {
    const fixture = setup([
      {
        kind: 'ready_to_accept',
        registration: {
          verificationId: VERIFICATION_ID,
          invitationId: INVITATION_ID,
          organizationId: ORGANIZATION_ID,
          authIds: {
            userId: 'user-recovery-1',
            credentialAccountId: 'account-recovery-1',
            initialSessionId: 'session-recovery-1',
          },
        },
        acceptorEmail: 'manager@example.com',
      },
    ])

    await expect(fixture.run()).resolves.toEqual({
      claimed: 1,
      accepted: 1,
      awaitingProvider: 0,
      compensated: 0,
      manualReview: 0,
      failures: 0,
    })
    expect(fixture.claimDue).toHaveBeenCalledWith({
      now: NOW,
      claimExpiresAt: new Date('2026-08-27T12:01:00.000Z'),
      limit: 100,
    })
    expect(fixture.reconcile).toHaveBeenCalledWith({
      verificationId: VERIFICATION_ID,
      now: NOW,
      nextRecoveryAt: new Date('2026-08-27T12:05:00.000Z'),
    })
    expect(fixture.acceptInvitation).toHaveBeenCalledWith(
      expect.objectContaining({
        invitationId: INVITATION_ID,
        acceptorEmail: 'manager@example.com',
        acceptorUserId: 'user-recovery-1',
      }),
    )
    expect(fixture.complete).toHaveBeenCalledWith(VERIFICATION_ID)
    expect(fixture.runOnAccepted).toHaveBeenCalledWith({
      userId: 'user-recovery-1',
      organizationId: ORGANIZATION_ID,
      propertyIds: ['property-1'],
    })
  })

  it('recognizes an acceptance that committed before its caller observed success', async () => {
    const fixture = setup([
      {
        kind: 'ready_to_accept',
        registration: {
          verificationId: VERIFICATION_ID,
          invitationId: INVITATION_ID,
          organizationId: ORGANIZATION_ID,
          authIds: {
            userId: 'user-recovery-1',
            credentialAccountId: 'account-recovery-1',
            initialSessionId: 'session-recovery-1',
          },
        },
        acceptorEmail: 'manager@example.com',
      },
      {
        kind: 'accepted',
        organizationId: ORGANIZATION_ID,
        propertyIds: ['property-1'],
        userId: 'user-recovery-1',
      },
    ])
    fixture.acceptInvitation.mockRejectedValueOnce(new Error('response interrupted'))

    await expect(fixture.run()).resolves.toMatchObject({ accepted: 1, failures: 0 })
    expect(fixture.reconcile).toHaveBeenCalledTimes(2)
    expect(fixture.runOnAccepted).toHaveBeenCalledOnce()
  })

  it.each([
    ['awaiting_provider', 'awaitingProvider'],
    ['compensated', 'compensated'],
    ['manual_review', 'manualReview'],
  ] as const)('settles %s without trying to accept again', async (kind, countKey) => {
    const fixture = setup([{ kind }])

    const result = await fixture.run()

    expect(result[countKey]).toBe(1)
    expect(fixture.acceptInvitation).not.toHaveBeenCalled()
    expect(fixture.runOnAccepted).not.toHaveBeenCalled()
  })

  it('continues the bounded batch after one verification fails', async () => {
    const fixture = setup([{ kind: 'compensated' }])
    fixture.claimDue.mockResolvedValueOnce([
      { verificationId: 'verification-broken' },
      { verificationId: VERIFICATION_ID },
    ])
    fixture.reconcile
      .mockReset()
      .mockRejectedValueOnce(new Error('database interruption'))
      .mockResolvedValueOnce({ kind: 'compensated' })

    await expect(fixture.run()).resolves.toMatchObject({
      claimed: 2,
      compensated: 1,
      failures: 1,
    })
    expect(fixture.logger.error).toHaveBeenCalledOnce()
  })
})
