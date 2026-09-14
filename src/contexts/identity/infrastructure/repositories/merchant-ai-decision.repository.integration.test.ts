import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { Pool } from 'pg'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { withLastOwnerGuardDisabled } from '#/shared/db/disable-guard-triggers'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { CURRENT_MERCHANT_AI_CAPABILITIES } from '../../application/use-cases/merchant-ai-authorization'
import { createMerchantAiAuthorizationStore } from './merchant-ai-authorization.repository'
import { createMerchantAiDecisionDeferralStore } from './merchant-ai-decision.repository'

const db = getDb()
let cleanupPool: Pool

const SUFFIX = randomUUID()
const ORG = `org-ai-deferral-${SUFFIX}`
const OTHER_ORG = `org-ai-deferral-other-${SUFFIX}`
const OWNER = `user-ai-deferral-owner-${SUFFIX}`
const MANAGER = `user-ai-deferral-manager-${SUFFIX}`
const OUTSIDER = `user-ai-deferral-outsider-${SUFFIX}`
const CONNECTION = randomUUID()
const PROPERTY = randomUUID()
const GRANTED_PROPERTY = randomUUID()
const OTHER_PROPERTY = randomUUID()
const FIRST_DEFERRAL = new Date('2026-09-15T08:00:00.000Z')
const LATER = new Date('2026-09-16T08:00:00.000Z')

const deferrals = createMerchantAiDecisionDeferralStore(db)
const authorizations = createMerchantAiAuthorizationStore(db, randomUUID)

function enableCommand(propertyId: string, idempotencyKey: string) {
  return {
    organizationId: ORG,
    propertyId,
    actorUserId: OWNER,
    idempotencyKey,
    expectedStateVersion: 0,
    operation: 'enable' as const,
    state: 'enabled' as const,
    capabilities: CURRENT_MERCHANT_AI_CAPABILITIES,
    reasonCode: 'merchant_enabled',
    noticeVersion: MERCHANT_AI_NOTICE_VERSION,
    noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
    sourcePolicyId: 'google-business-profile-source-policy-v1',
    routingPolicyVersion: 1,
    providerDeploymentProfileVersion: 'private-beta-global-v1' as const,
    redactionProfileFamily: 'gbp-review-global-v1',
    now: FIRST_DEFERRAL,
  }
}

async function insertProperty(
  organizationId: string,
  propertyId: string,
  slug: string,
): Promise<void> {
  await db.execute(sql`
    INSERT INTO properties (
      id, organization_id, name, slug, timezone, lifecycle_state,
      google_connection_id, gbp_account_id, gbp_location_id,
      google_binding_state, profile_source, source_epoch
    ) VALUES (
      ${propertyId}::uuid, ${organizationId}, 'Deferral Property', ${slug}, 'UTC',
      'active', ${organizationId === ORG ? CONNECTION : null}::uuid,
      ${organizationId === ORG ? `account-${slug}` : null},
      ${organizationId === ORG ? `location-${slug}` : null},
      ${organizationId === ORG ? 'active' : 'unbound'}, 'legacy', 0
    )
  `)
}

async function deferralRows(propertyId: string): Promise<number> {
  const result = await db.execute(sql`
    SELECT count(*)::int AS rows
    FROM merchant_ai_decision_deferrals
    WHERE property_id = ${propertyId}::uuid
  `)
  return Number((result.rows[0] as { rows: number }).rows)
}

/**
 * Wait until `count` sessions in this database are queued on a lock. The
 * integration project runs files serially, so every waiter is this file's.
 */
async function waitForLockWaiters(count: number): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const result = await db.execute(sql`
      SELECT count(*)::int AS waiting
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND wait_event_type = 'Lock'
    `)
    if (Number((result.rows[0] as { waiting: number }).waiting) >= count) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`Expected ${count} Merchant AI command(s) blocked on the Property lock`)
}

/**
 * Hold the Property row lock that both commands take first, start them in the
 * given order, and release them together once both are queued behind it.
 */
async function raceBehindPropertyLock<A, B>(
  first: () => Promise<A>,
  second: () => Promise<B>,
): Promise<[A, B]> {
  const blocker = await cleanupPool.connect()
  try {
    await blocker.query('BEGIN')
    await blocker.query(
      'SELECT id FROM properties WHERE organization_id = $1 AND id = $2 FOR UPDATE',
      [ORG, PROPERTY],
    )
    const firstResult = first()
    await waitForLockWaiters(1)
    const secondResult = second()
    await waitForLockWaiters(2)
    await blocker.query('COMMIT')
    return await Promise.all([firstResult, secondResult])
  } finally {
    await blocker.query('ROLLBACK')
    blocker.release()
  }
}

async function removeProperties(): Promise<void> {
  for (const organizationId of [ORG, OTHER_ORG]) {
    await db.execute(
      sql`DELETE FROM outbox_events WHERE organization_id = ${organizationId}`,
    )
    await db.execute(
      sql`DELETE FROM properties WHERE organization_id = ${organizationId}`,
    )
  }
}

beforeAll(async () => {
  cleanupPool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 1 })
  registerAllEventSchemas()
  for (const [organizationId, slug] of [
    [ORG, `ai-deferral-${SUFFIX}`],
    [OTHER_ORG, `ai-deferral-other-${SUFFIX}`],
  ] as const) {
    await db.execute(sql`
      INSERT INTO organization (id, name, slug, "createdAt")
      VALUES (${organizationId}, 'Merchant AI deferral', ${slug}, now())
    `)
  }
  for (const [userId, role] of [
    [OWNER, 'owner'],
    [MANAGER, 'admin'],
  ] as const) {
    await db.execute(sql`
      INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
      VALUES (${userId}, 'Deferral Manager', ${`${userId}@example.test`}, true, now(), now())
    `)
    await db.execute(sql`
      INSERT INTO member (id, "userId", "organizationId", role, "createdAt")
      VALUES (${`member-${userId}`}, ${userId}, ${ORG}, ${role}, now())
    `)
  }
  await db.execute(sql`
    INSERT INTO google_connections (
      id, organization_id, google_subject, encrypted_access_token,
      encrypted_refresh_token, token_expires_at, scopes, connected_by,
      visibility, status
    ) VALUES (
      ${CONNECTION}::uuid, ${ORG}, ${`deferral-subject-${SUFFIX}`},
      'encrypted-access', 'encrypted-refresh', now() + interval '1 hour',
      ARRAY['https://www.googleapis.com/auth/business.manage'], ${OWNER},
      'organization', 'active'
    )
  `)
})

beforeEach(async () => {
  registerAllEventSchemas()
  await removeProperties()
  await insertProperty(ORG, PROPERTY, `deferral-${SUFFIX}`)
  await insertProperty(ORG, GRANTED_PROPERTY, `deferral-granted-${SUFFIX}`)
  await insertProperty(OTHER_ORG, OTHER_PROPERTY, `deferral-other-${SUFFIX}`)
  await db.execute(sql`
    INSERT INTO property_access_grant (
      organization_id, property_id, user_id, source, created_by
    ) VALUES (${ORG}, ${GRANTED_PROPERTY}::uuid, ${MANAGER}, 'operator', ${OWNER})
  `)
})

afterAll(async () => {
  await removeProperties()
  await db.execute(sql`DELETE FROM google_connections WHERE id = ${CONNECTION}::uuid`)
  await withLastOwnerGuardDisabled(cleanupPool, async (client) => {
    await client.query('DELETE FROM member WHERE "organizationId" = $1', [ORG])
    await client.query('DELETE FROM "user" WHERE id = ANY($1::text[])', [
      [OWNER, MANAGER],
    ])
    await deleteTestOrganizations(client, [ORG, OTHER_ORG])
  })
  await cleanupPool.end()
})

describe('Merchant AI decision deferral store', () => {
  it('keeps one standing deferral per Property and returns the first on a repeat', async () => {
    const first = await deferrals.deferDecision({
      organizationId: ORG,
      propertyId: PROPERTY,
      actorUserId: OWNER,
      now: FIRST_DEFERRAL,
    })
    const repeat = await deferrals.deferDecision({
      organizationId: ORG,
      propertyId: PROPERTY,
      actorUserId: OWNER,
      now: LATER,
    })

    const expected = {
      outcome: 'deferred',
      deferral: {
        organizationId: ORG,
        propertyId: PROPERTY,
        deferredBy: OWNER,
        deferredAt: FIRST_DEFERRAL,
      },
    }
    expect(first).toEqual(expected)
    expect(repeat).toEqual(expected)
    expect(await deferralRows(PROPERTY)).toBe(1)
    await expect(
      deferrals.findDecisionDeferral({ organizationId: ORG, propertyId: PROPERTY }),
    ).resolves.toEqual(expected.deferral)
  })

  it('refuses to defer while AI is enabled and records nothing', async () => {
    await authorizations.mutate(
      enableCommand(PROPERTY, `deferral-enable-${randomUUID()}`),
    )

    await expect(
      deferrals.deferDecision({
        organizationId: ORG,
        propertyId: PROPERTY,
        actorUserId: OWNER,
        now: LATER,
      }),
    ).resolves.toEqual({ outcome: 'already_enabled' })
    expect(await deferralRows(PROPERTY)).toBe(0)
  })

  it('deletes the deferral inside the enable transaction, and keeps it when enable rolls back', async () => {
    await deferrals.deferDecision({
      organizationId: ORG,
      propertyId: PROPERTY,
      actorUserId: OWNER,
      now: FIRST_DEFERRAL,
    })

    // An unregistered outbox fact fails the enable after the deferral delete
    // ran: the whole transaction must roll back with it.
    clearEventSchemas()
    await expect(
      authorizations.mutate(enableCommand(PROPERTY, `deferral-rollback-${randomUUID()}`)),
    ).rejects.toMatchObject({ name: 'OutboxPayloadError', code: 'unregistered' })
    expect(await deferralRows(PROPERTY)).toBe(1)

    registerAllEventSchemas()
    await expect(
      authorizations.mutate(enableCommand(PROPERTY, `deferral-commit-${randomUUID()}`)),
    ).resolves.toMatchObject({ state: 'enabled' })
    expect(await deferralRows(PROPERTY)).toBe(0)
  })

  it('allows a new deferral once AI is revoked again', async () => {
    const enabled = await authorizations.mutate(
      enableCommand(PROPERTY, `deferral-reenable-${randomUUID()}`),
    )
    await authorizations.mutate({
      ...enableCommand(PROPERTY, `deferral-revoke-${randomUUID()}`),
      operation: 'revoke',
      state: 'revoked',
      capabilities: [],
      reasonCode: 'merchant_revoked',
      expectedStateVersion: enabled.stateVersion,
    })

    await expect(
      deferrals.deferDecision({
        organizationId: ORG,
        propertyId: PROPERTY,
        actorUserId: OWNER,
        now: LATER,
      }),
    ).resolves.toMatchObject({ outcome: 'deferred', deferral: { deferredAt: LATER } })
  })

  it('rechecks AI management authority inside the transaction', async () => {
    const attempt = (propertyId: string, actorUserId: string) =>
      deferrals.deferDecision({
        organizationId: ORG,
        propertyId,
        actorUserId,
        now: LATER,
      })

    // A PropertyManager needs a current grant; a non-member never passes.
    await expect(attempt(PROPERTY, MANAGER)).resolves.toEqual({
      outcome: 'authority_denied',
    })
    await expect(attempt(PROPERTY, OUTSIDER)).resolves.toEqual({
      outcome: 'authority_denied',
    })
    await expect(attempt(GRANTED_PROPERTY, MANAGER)).resolves.toMatchObject({
      outcome: 'deferred',
      deferral: { deferredBy: MANAGER },
    })
    expect(await deferralRows(PROPERTY)).toBe(0)
  })

  it('never reads or writes across Organizations', async () => {
    await deferrals.deferDecision({
      organizationId: ORG,
      propertyId: PROPERTY,
      actorUserId: OWNER,
      now: FIRST_DEFERRAL,
    })

    await expect(
      deferrals.findDecisionDeferral({ organizationId: OTHER_ORG, propertyId: PROPERTY }),
    ).resolves.toBeNull()
    await expect(
      deferrals.deferDecision({
        organizationId: ORG,
        propertyId: OTHER_PROPERTY,
        actorUserId: OWNER,
        now: LATER,
      }),
    ).resolves.toEqual({ outcome: 'property_not_found' })
    expect(await deferralRows(OTHER_PROPERTY)).toBe(0)
  })

  it('lets an enable queued behind a concurrent deferral delete the row it committed', async () => {
    const [deferred, enabled] = await raceBehindPropertyLock(
      () =>
        deferrals.deferDecision({
          organizationId: ORG,
          propertyId: PROPERTY,
          actorUserId: OWNER,
          now: FIRST_DEFERRAL,
        }),
      () =>
        authorizations.mutate(enableCommand(PROPERTY, `deferral-race-${randomUUID()}`)),
    )

    expect(deferred.outcome).toBe('deferred')
    expect(enabled.state).toBe('enabled')
    expect(await deferralRows(PROPERTY)).toBe(0)
  })

  it('refuses a deferral queued behind a concurrent enable', async () => {
    const [enabled, deferred] = await raceBehindPropertyLock(
      () =>
        authorizations.mutate(enableCommand(PROPERTY, `deferral-race-${randomUUID()}`)),
      () =>
        deferrals.deferDecision({
          organizationId: ORG,
          propertyId: PROPERTY,
          actorUserId: OWNER,
          now: LATER,
        }),
    )

    expect(enabled.state).toBe('enabled')
    expect(deferred).toEqual({ outcome: 'already_enabled' })
    expect(await deferralRows(PROPERTY)).toBe(0)
  })

  it('is removed by the Property cascade that Organization purge relies on', async () => {
    await deferrals.deferDecision({
      organizationId: ORG,
      propertyId: GRANTED_PROPERTY,
      actorUserId: OWNER,
      now: FIRST_DEFERRAL,
    })
    expect(await deferralRows(GRANTED_PROPERTY)).toBe(1)

    await db.execute(sql`
      DELETE FROM property_access_grant
      WHERE organization_id = ${ORG} AND property_id = ${GRANTED_PROPERTY}::uuid
    `)
    await db.execute(sql`
      DELETE FROM properties
      WHERE organization_id = ${ORG} AND id = ${GRANTED_PROPERTY}::uuid
    `)

    expect(await deferralRows(GRANTED_PROPERTY)).toBe(0)
  })
})
