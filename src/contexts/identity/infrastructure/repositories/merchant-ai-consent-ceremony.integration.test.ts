import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { Pool } from 'pg'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { withLastOwnerGuardDisabled } from '#/shared/db/disable-guard-triggers'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'
import { createMerchantAiAuthorizationStore } from './merchant-ai-authorization.repository'
import {
  CURRENT_MERCHANT_AI_CAPABILITIES,
  type MerchantAiConsentCeremonyInput,
} from '../../application/use-cases/merchant-ai-authorization'

// Fixtures are distinct from the single-Property store suite: integration files
// share one PostgreSQL database.
const db = getDb()
let cleanupPool: Pool
const store = createMerchantAiAuthorizationStore(db, randomUUID)

const ORG = '31000000-0000-4000-8000-000000000001'
const OWNER = 'user-merchant-ai-ceremony-owner'
const MANAGER = 'user-merchant-ai-ceremony-manager'
const CONNECTION = '21000000-0000-4000-8000-000000000001'
// Listed in lock (sort) order, so a refusal at D arrives after A to C have
// already written inside the ceremony's transaction.
const PROPERTY_A = '11000000-0000-4000-8000-00000000000a'
const PROPERTY_B = '11000000-0000-4000-8000-00000000000b'
const PROPERTY_C = '11000000-0000-4000-8000-00000000000c'
const PROPERTY_D = '11000000-0000-4000-8000-00000000000d'
const PROPERTIES = [PROPERTY_A, PROPERTY_B, PROPERTY_C, PROPERTY_D]
const NOW = new Date('2026-09-15T09:00:00.000Z')
const PREVIOUS_NOTICE_VERSION = 'merchant-ai-notice-2026-09-09.v1'
const PREVIOUS_NOTICE_DIGEST =
  'd80fe3b03f89697cde6c46810053248206aa3745b5f4a5522a24c1c2fdb438e1'

const POLICY = {
  sourcePolicyId: 'google-business-profile-source-policy-v1',
  routingPolicyVersion: 1,
  providerDeploymentProfileVersion: 'private-beta-global-v1' as const,
  redactionProfileFamily: 'gbp-review-global-v1',
}

function ceremony(
  overrides: Partial<MerchantAiConsentCeremonyInput> = {},
): MerchantAiConsentCeremonyInput {
  return {
    organizationId: ORG,
    actorUserId: OWNER,
    propertyIds: [PROPERTY_A, PROPERTY_B],
    capabilities: CURRENT_MERCHANT_AI_CAPABILITIES,
    idempotencyKey: 'ceremony-it-0001',
    reasonCode: 'merchant_enabled',
    noticeVersion: MERCHANT_AI_NOTICE_VERSION,
    noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
    ...POLICY,
    now: NOW,
    ceremonyId: randomUUID(),
    ...overrides,
  }
}

async function enableSingle(
  propertyId: string,
  notice: Readonly<{ version: string; digest: string }>,
): Promise<void> {
  await store.mutate({
    organizationId: ORG,
    propertyId,
    actorUserId: OWNER,
    idempotencyKey: `single-enable-${propertyId}`,
    expectedStateVersion: 0,
    operation: 'enable',
    state: 'enabled',
    capabilities: CURRENT_MERCHANT_AI_CAPABILITIES,
    reasonCode: 'merchant_enabled',
    noticeVersion: notice.version,
    noticeDigest: notice.digest,
    ...POLICY,
    now: NOW,
    ceremonyId: randomUUID(),
  })
}

async function counts(): Promise<Readonly<{ evidence: number; events: number }>> {
  const result = await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM merchant_ai_consent_evidence WHERE organization_id = ${ORG}) AS evidence,
      (SELECT count(*)::int FROM outbox_events
        WHERE organization_id = ${ORG} AND event_type = 'identity.merchant_ai.changed') AS events
  `)
  return result.rows[0] as { evidence: number; events: number }
}

async function insertProperties(): Promise<void> {
  for (const [index, propertyId] of PROPERTIES.entries()) {
    await db.execute(sql`
      INSERT INTO properties (
        id, organization_id, name, slug, timezone, lifecycle_state,
        google_connection_id, gbp_account_id, gbp_location_id,
        google_binding_state, profile_source, source_epoch
      ) VALUES (
        ${propertyId}::uuid, ${ORG}, ${`Ceremony Property ${index}`},
        ${`ceremony-property-${index}`}, 'UTC', 'active',
        ${CONNECTION}::uuid, 'ceremony-account', ${`ceremony-location-${index}`},
        'active', 'legacy', 0
      )
    `)
    await db.execute(sql`
      INSERT INTO review_ai_analysis_heads (
        organization_id, property_id, source_epoch, head_sequence
      ) VALUES (${ORG}, ${propertyId}::uuid, 0, 5)
    `)
    await db.execute(sql`
      INSERT INTO property_access_grant (
        organization_id, property_id, user_id, source, created_by
      ) VALUES (${ORG}, ${propertyId}::uuid, ${MANAGER}, 'operator', ${OWNER})
    `)
  }
}

async function resetProperties(): Promise<void> {
  await db.execute(sql`DELETE FROM outbox_events WHERE organization_id = ${ORG}`)
  for (const propertyId of PROPERTIES) {
    await db.execute(sql`DELETE FROM properties WHERE id = ${propertyId}::uuid`)
  }
}

beforeAll(async () => {
  cleanupPool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 1 })
  await withLastOwnerGuardDisabled(cleanupPool, async (client) => {
    await client.query('DELETE FROM member WHERE "organizationId" = $1', [ORG])
  })
  clearEventSchemas()
  registerAllEventSchemas()
  await resetProperties()
  await db.execute(sql`DELETE FROM google_connections WHERE id = ${CONNECTION}::uuid`)
  await db.execute(sql`DELETE FROM "user" WHERE id IN (${OWNER}, ${MANAGER})`)
  await deleteTestOrganizations(db, [ORG])
  await db.execute(sql`
    INSERT INTO organization (id, name, slug, "createdAt")
    VALUES (${ORG}, 'Merchant AI Ceremony', ${ORG}, now())
  `)
  for (const [id, email] of [
    [OWNER, 'merchant-ai-ceremony-owner@example.test'],
    [MANAGER, 'merchant-ai-ceremony-manager@example.test'],
  ] as const) {
    await db.execute(sql`
      INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
      VALUES (${id}, ${id}, ${email}, true, now(), now())
    `)
  }
  await db.execute(sql`
    INSERT INTO member (id, "userId", "organizationId", role, "createdAt")
    VALUES
      ('member-merchant-ai-ceremony-owner', ${OWNER}, ${ORG}, 'owner', now()),
      ('member-merchant-ai-ceremony-manager', ${MANAGER}, ${ORG}, 'admin', now())
  `)
  await db.execute(sql`
    INSERT INTO google_connections (
      id, organization_id, google_subject, encrypted_access_token,
      encrypted_refresh_token, token_expires_at, scopes, connected_by,
      visibility, status
    ) VALUES (
      ${CONNECTION}::uuid, ${ORG}, 'merchant-ai-ceremony-subject',
      'encrypted-access', 'encrypted-refresh', now() + interval '1 hour',
      ARRAY['https://www.googleapis.com/auth/business.manage'], ${OWNER},
      'organization', 'active'
    )
  `)
})

beforeEach(async () => {
  await resetProperties()
  await insertProperties()
})

afterAll(async () => {
  await resetProperties()
  await db.execute(sql`DELETE FROM google_connections WHERE id = ${CONNECTION}::uuid`)
  await withLastOwnerGuardDisabled(cleanupPool, async (client) => {
    await client.query('DELETE FROM member WHERE "organizationId" = $1', [ORG])
    await client.query('DELETE FROM "user" WHERE id = ANY($1)', [[OWNER, MANAGER]])
    await deleteTestOrganizations(client, [ORG])
  })
  await cleanupPool.end()
})

describe('Merchant AI consent ceremony store', () => {
  it('enables, re-grants and leaves current grants alone in one transaction under one ceremony id', async () => {
    await enableSingle(PROPERTY_B, {
      version: PREVIOUS_NOTICE_VERSION,
      digest: PREVIOUS_NOTICE_DIGEST,
    })
    await enableSingle(PROPERTY_C, {
      version: MERCHANT_AI_NOTICE_VERSION,
      digest: MERCHANT_AI_NOTICE_DIGEST,
    })
    const before = await counts()
    const ceremonyId = randomUUID()

    const results = await store.enableForProperties(
      ceremony({
        // Deliberately not in lock order: results follow the caller's order.
        propertyIds: [PROPERTY_C, PROPERTY_A, PROPERTY_B],
        ceremonyId,
      }),
    )

    expect(results.map(({ propertyId, outcome }) => ({ propertyId, outcome }))).toEqual([
      { propertyId: PROPERTY_C, outcome: 'unchanged' },
      { propertyId: PROPERTY_A, outcome: 'enabled' },
      { propertyId: PROPERTY_B, outcome: 'changed' },
    ])
    for (const result of results) {
      await expect(
        store.getSnapshot({ organizationId: ORG, propertyId: result.propertyId }),
      ).resolves.toEqual(result.snapshot)
      expect(result.snapshot).toMatchObject({
        state: 'enabled',
        noticeVersion: MERCHANT_AI_NOTICE_VERSION,
        noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
      })
    }

    const written = await db.execute(sql`
      SELECT property_id, transition_kind, reason_code, actor_user_id,
             notice_version, request_hash
      FROM merchant_ai_consent_evidence
      WHERE organization_id = ${ORG}
        AND ceremony_id = ${ceremonyId}::uuid
      ORDER BY property_id
    `)
    expect(written.rows).toEqual([
      expect.objectContaining({
        property_id: PROPERTY_A,
        transition_kind: 'enable',
        reason_code: 'merchant_enabled',
        actor_user_id: OWNER,
        notice_version: MERCHANT_AI_NOTICE_VERSION,
      }),
      expect.objectContaining({
        property_id: PROPERTY_B,
        transition_kind: 'change',
        actor_user_id: OWNER,
        notice_version: MERCHANT_AI_NOTICE_VERSION,
      }),
    ])
    // One ceremony, one request: every row it wrote carries the same hash.
    expect(written.rows[0]?.request_hash).toBe(written.rows[1]?.request_hash)
    // The unchanged Property wrote no evidence and no fact.
    expect(await counts()).toEqual({
      evidence: before.evidence + 2,
      events: before.events + 2,
    })
    const facts = await db.execute(sql`
      SELECT payload->>'propertyId' AS property_id
      FROM outbox_events
      WHERE organization_id = ${ORG}
        AND event_type = 'identity.merchant_ai.changed'
      ORDER BY payload->>'propertyId', (payload->>'stateVersion')::int
    `)
    expect(facts.rows.map((row) => row.property_id)).toEqual([
      PROPERTY_A,
      PROPERTY_B,
      PROPERTY_B,
      PROPERTY_C,
    ])

    // A later ceremony over grants that are already current changes nothing.
    const settled = await counts()
    const again = await store.enableForProperties(
      ceremony({
        propertyIds: [PROPERTY_A, PROPERTY_B, PROPERTY_C],
        idempotencyKey: 'ceremony-it-0002',
      }),
    )
    expect(again.map(({ outcome }) => outcome)).toEqual([
      'unchanged',
      'unchanged',
      'unchanged',
    ])
    expect(await counts()).toEqual(settled)
  })

  it('replays a committed ceremony without writing and refuses its key for another request', async () => {
    const first = await store.enableForProperties(ceremony())
    const committed = await counts()

    // A retry mints a new ceremony id; the committed ceremony answers it.
    await expect(store.enableForProperties(ceremony())).resolves.toEqual(first)
    await expect(
      store.enableForProperties(ceremony({ propertyIds: [PROPERTY_B, PROPERTY_A] })),
    ).resolves.toEqual([first[1], first[0]])
    expect(await counts()).toEqual(committed)

    for (const reused of [
      ceremony({ capabilities: ['review_analysis'] }),
      ceremony({ propertyIds: [PROPERTY_A] }),
      ceremony({ propertyIds: [PROPERTY_C] }),
    ]) {
      await expect(store.enableForProperties(reused)).rejects.toMatchObject({
        code: 'idempotency_conflict',
      })
    }
    expect(await counts()).toEqual(committed)
  })

  it('serializes concurrent attempts of one ceremony so exactly one writes', async () => {
    const attempts = await Promise.all([
      store.enableForProperties(ceremony()),
      store.enableForProperties(ceremony()),
    ])

    expect(attempts[1]).toEqual(attempts[0])
    expect(await counts()).toEqual({ evidence: 2, events: 2 })
  })

  it('rolls back every Property when one refuses and names the one that did', async () => {
    await db.execute(sql`
      UPDATE properties SET lifecycle_state = 'suspended' WHERE id = ${PROPERTY_D}::uuid
    `)

    await expect(
      store.enableForProperties(
        ceremony({ propertyIds: [PROPERTY_D, PROPERTY_A, PROPERTY_B, PROPERTY_C] }),
      ),
    ).rejects.toMatchObject({
      code: 'property_inactive',
      propertyId: PROPERTY_D,
    })

    expect(await counts()).toEqual({ evidence: 0, events: 0 })
    for (const propertyId of [PROPERTY_A, PROPERTY_B, PROPERTY_C]) {
      await expect(
        store.getSnapshot({ organizationId: ORG, propertyId }),
      ).resolves.toBeNull()
    }
  })

  it('refuses a ceremony from anyone but a current account admin', async () => {
    await expect(
      store.enableForProperties(ceremony({ actorUserId: MANAGER })),
    ).rejects.toMatchObject({ code: 'membership_denied' })

    expect(await counts()).toEqual({ evidence: 0, events: 0 })
  })
})
