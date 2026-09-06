import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { executeWithLastOwnerGuardDisabled } from '#/shared/db/disable-guard-triggers'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { createOrganizationLifecycleCommandStore } from './organization-lifecycle-command-store'
import {
  createDefaultOrganizationReactivationReadiness,
  quarantinedReactivationSchedules,
} from './organization-reactivation-readiness'
import {
  OrganizationReactivationBlocked,
  reactivateOrganization,
} from '../application/use-cases/reactivate-organization'
import type { OrganizationReactivationAcknowledgement } from '../domain/organization-lifecycle'

const PREFIX = 'org-reactivation-integration-'
const REQUESTED_AT = new Date('2026-08-28T09:30:00.000Z')
const RECOVERABLE_UNTIL = new Date('2026-09-27T09:30:00.000Z')
const CANCELLED_AT = new Date('2026-09-01T09:30:00.000Z')
const NOW = new Date('2026-09-01T10:00:00.000Z')

let lease: TestLease
let db: Database
const organizations = new Set<string>()
const users = new Set<string>()

const acknowledgements: readonly OrganizationReactivationAcknowledgement[] = [
  { id: 'portal_republished', actorUserId: 'human-1', reasonCode: 'portal_restored' },
  {
    id: 'ai_capability_reviewed',
    actorUserId: 'human-1',
    reasonCode: 'ai_left_disabled',
  },
  { id: 'google_reauthorized', actorUserId: 'human-1', reasonCode: 'fresh_consent' },
]

const satisfiedProbe = async () => ({ satisfied: true, detailCode: 'ready' })

const readiness = () =>
  createDefaultOrganizationReactivationReadiness({
    admitDataCell: async () => ({ accepting: true, detailCode: 'cell_us_accepting' }),
    hasEligibleResponsibleManagers: satisfiedProbe,
    hasFreshGoogleAuthorization: satisfiedProbe,
    hasDeliberatePortalReactivation: satisfiedProbe,
  })

async function seedCancelledClosure() {
  const suffix = randomUUID()
  const organizationId = `${PREFIX}org-${suffix}`
  const actorUserId = `${PREFIX}user-${suffix}`
  organizations.add(organizationId)
  users.add(actorUserId)
  await lease.pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1, 'Reactivation fixture', $1, $2)`,
    [organizationId, REQUESTED_AT],
  )
  await lease.pool.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ($1, 'Reactivation actor', $2, true, $3, $3)`,
    [actorUserId, `${actorUserId}@example.test`, REQUESTED_AT],
  )
  await lease.pool.query(
    `INSERT INTO member (id, "userId", "organizationId", role, "createdAt")
     VALUES ($1, $2, $3, 'owner', $4)`,
    [`${PREFIX}member-${suffix}`, actorUserId, organizationId, REQUESTED_AT],
  )
  await lease.pool.query(
    `INSERT INTO user_organization_bindings (
       user_id, organization_id, state, source, version, created_at, updated_at
     ) VALUES ($1, $2, 'active', 'operator', 1, $3, $3)`,
    [actorUserId, organizationId, REQUESTED_AT],
  )

  const store = createOrganizationLifecycleCommandStore(db)
  await store.requestClosure({
    operationId: randomUUID(),
    organizationId,
    actorUserId,
    reasonCode: 'account_admin_request',
    supportEvidenceRef: 'support:reactivation-fixture',
    now: REQUESTED_AT,
    recoverableUntil: RECOVERABLE_UNTIL,
  })
  await store.cancelClosure({
    operationId: randomUUID(),
    organizationId,
    actorUserId,
    reasonCode: 'closure_cancelled',
    supportEvidenceRef: 'support:reactivation-fixture-cancel',
    now: CANCELLED_AT,
  })
  return { organizationId, actorUserId, store }
}

describe('Organization reactivation readiness (real PostgreSQL)', () => {
  beforeAll(async () => {
    registerAllEventSchemas()
    lease = await acquireTestLease(getEnv().DATABASE_URL)
    db = drizzle(lease.pool)
  })

  afterAll(async () => {
    for (const organizationId of organizations) {
      await lease.pool.query('DELETE FROM outbox_events WHERE organization_id = $1', [
        organizationId,
      ])
      await lease.pool.query(
        'DELETE FROM organization_lifecycle_command_receipts WHERE organization_id = $1',
        [organizationId],
      )
      await lease.pool.query(
        'DELETE FROM user_organization_bindings WHERE organization_id = $1',
        [organizationId],
      )
      await executeWithLastOwnerGuardDisabled(db, [
        sql`DELETE FROM member WHERE "organizationId" = ${organizationId}`,
      ])
      // Removes the lifecycle authority before the Organization, so the
      // policy row cascades without tripping the deliberate lifecycle fence.
      await deleteTestOrganizations(lease.pool, [organizationId])
    }
    for (const userId of users) {
      await lease.pool.query('DELETE FROM "user" WHERE id = $1', [userId])
    }
    await lease.release()
  })

  /**
   * LIF-01 keeps every lifecycle schedule quarantined until crash recovery,
   * backup fencing and counsel-approved retention exist. Reactivation is
   * therefore fenced by the same containment as the rest of the destructive
   * lifecycle, and this test pins that rather than asserting an aspiration.
   */
  it('reports the lifecycle schedules as quarantined while LIF-01 containment holds', () => {
    expect(quarantinedReactivationSchedules()).toContain('advance-organization-lifecycle')
  })

  it('refuses reactivation while any schedule the workspace needs is quarantined', async () => {
    const { organizationId, actorUserId, store } = await seedCancelledClosure()
    const useCase = reactivateOrganization({
      store,
      readiness: readiness(),
      clock: () => NOW,
      refreshPolicy: async () => {},
    })

    const error = await useCase({
      operationId: randomUUID(),
      organizationId,
      actorUserId,
      acknowledgements,
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(OrganizationReactivationBlocked)
    expect((error as OrganizationReactivationBlocked).unsatisfiedChecks).toEqual([
      'schedule_quarantine_cleared',
    ])

    // Nothing resumed: the fence and the suspension are both intact.
    const authority = await lease.pool.query(
      'SELECT state, reactivation_required FROM organization_lifecycle_authority WHERE organization_id = $1',
      [organizationId],
    )
    expect(authority.rows[0]).toMatchObject({
      state: 'active',
      reactivation_required: true,
    })
    const policy = await lease.pool.query(
      'SELECT suspended_reason FROM organization_policy WHERE organization_id = $1',
      [organizationId],
    )
    expect(policy.rows[0]?.suspended_reason).toBe('lifecycle:closure_requested')
  })

  it('refuses a PropertyManager before it evaluates any readiness question', async () => {
    const { organizationId, store } = await seedCancelledClosure()
    let evaluated = 0
    const useCase = reactivateOrganization({
      store,
      readiness: {
        evaluate: async () => {
          evaluated += 1
          return []
        },
      },
      clock: () => NOW,
      refreshPolicy: async () => {},
    })

    await expect(
      useCase({
        operationId: randomUUID(),
        organizationId,
        actorUserId: `${PREFIX}not-a-member`,
        acknowledgements,
      }),
    ).rejects.toMatchObject({ _tag: 'IdentityError', code: 'forbidden' })
    expect(evaluated).toBe(0)
  })
})
