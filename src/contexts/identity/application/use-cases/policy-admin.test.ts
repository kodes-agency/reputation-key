// The operator grant and revoke hand their store the fact that commits with
// the change: the member it concerns, the acting AccountAdmin, and the one
// Property granted or revoked.

import { describe, expect, it, vi } from 'vitest'
import type {
  GrantPropertyAccessCommand,
  RevokePropertyAccessCommand,
} from '../ports/policy-admin-command-store.port'
import { createPolicyAdminOps } from './policy-admin'

const NOW = new Date('2026-07-17T12:00:00Z')
const PROPERTY_ID = 'd4000000-0000-4000-8000-000000000088'

const target = {
  organizationId: 'org-1',
  propertyId: PROPERTY_ID,
  userId: 'user-manager',
  actorUserId: 'user-admin',
  now: NOW,
} as const

function harness() {
  const granted: GrantPropertyAccessCommand[] = []
  const revoked: RevokePropertyAccessCommand[] = []
  const reconcile = vi.fn(async () => undefined)
  const ops = createPolicyAdminOps({
    explainPolicyDecision: async () => {
      throw new Error('not used')
    },
    commandStore: {
      grantPropertyAccess: async (command) => {
        granted.push(command)
      },
      revokePropertyAccess: async (command) => {
        revoked.push(command)
      },
    },
    reconcileResponsibleManagerEligibility: reconcile,
  })
  return { ops, granted, revoked, reconcile }
}

describe('operator Property access administration', () => {
  it('grants with the fact that names the member, the actor and the Property', async () => {
    const { ops, granted } = harness()
    const expiresAt = new Date(NOW.getTime() + 60_000)

    await ops.grantPropertyAccessOp({
      ...target,
      reason: 'covering for holiday',
      ticketRef: 'OPS-1',
      expiresAt,
    })

    expect(granted).toHaveLength(1)
    expect(granted[0]).toMatchObject({
      organizationId: 'org-1',
      propertyId: PROPERTY_ID,
      userId: 'user-manager',
      createdBy: 'user-admin',
      expiresAt,
      now: NOW,
    })
    expect(granted[0]?.buildEvent()).toMatchObject({
      _tag: 'identity.member.property_access_changed',
      organizationId: 'org-1',
      memberUserId: 'user-manager',
      userId: 'user-admin',
      grantedPropertyIds: [PROPERTY_ID],
      revokedPropertyIds: [],
      occurredAt: NOW,
    })
  })

  it('revokes with the fact that names the revoked Property, then reconciles', async () => {
    const { ops, revoked, reconcile } = harness()

    await ops.revokePropertyAccessOp({ ...target, reason: 'cover ended' })

    expect(revoked).toHaveLength(1)
    expect(revoked[0]?.buildEvent()).toMatchObject({
      _tag: 'identity.member.property_access_changed',
      memberUserId: 'user-manager',
      userId: 'user-admin',
      grantedPropertyIds: [],
      revokedPropertyIds: [PROPERTY_ID],
      occurredAt: NOW,
    })
    expect(reconcile).toHaveBeenCalledExactlyOnceWith(
      'org-1',
      'user-manager',
      'user-admin',
    )
  })

  // Each refusal is a tagged IdentityError, so the server adapter maps it by
  // its code and never by the wording of its message.
  it('refuses an expiry that is not in the future before anything is written', async () => {
    const { ops, granted } = harness()

    await expect(
      ops.grantPropertyAccessOp({
        ...target,
        reason: 'covering for holiday',
        ticketRef: 'OPS-1',
        expiresAt: NOW,
      }),
    ).rejects.toMatchObject({
      _tag: 'IdentityError',
      code: 'validation_error',
      message: 'expiresAt must be in the future for temporary access',
    })

    expect(granted).toEqual([])
  })

  it.each([
    ['a reason under three characters', { reason: ' a ', ticketRef: 'OPS-1' }],
    ['a ticket reference under two characters', { reason: 'cover', ticketRef: ' ' }],
  ])('refuses a grant with %s as a validation error', async (_label, fields) => {
    const { ops, granted } = harness()

    await expect(
      ops.grantPropertyAccessOp({ ...target, ...fields }),
    ).rejects.toMatchObject({ _tag: 'IdentityError', code: 'validation_error' })

    expect(granted).toEqual([])
  })

  it('refuses a revoke without a reason as a validation error, and reconciles nothing', async () => {
    const { ops, revoked, reconcile } = harness()

    await expect(
      ops.revokePropertyAccessOp({ ...target, reason: '' }),
    ).rejects.toMatchObject({ _tag: 'IdentityError', code: 'validation_error' })

    expect(revoked).toEqual([])
    expect(reconcile).not.toHaveBeenCalled()
  })
})
