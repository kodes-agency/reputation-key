import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { Pool } from 'pg'
import { getDb } from '#/shared/db'
import { properties } from '#/shared/db/schema'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'
import {
  MAX_AI_REVIEW_SOURCE_CANONICAL_BYTES_V1,
  MAX_AI_REVIEW_SOURCE_RAW_BYTES_V1,
} from '#/shared/ai-review-source-contract'
import {
  createMerchantAiAuthorizationStore,
  hasActiveMerchantAiConsent,
  type MerchantAiAuthorizationFence,
} from './merchant-ai-authorization.repository'
import {
  CURRENT_MERCHANT_AI_CAPABILITIES,
  MerchantAiAuthorizationStoreError,
  type MerchantAiSnapshot,
} from '../../application/use-cases/merchant-ai-authorization'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { getEnv } from '#/shared/config/env'
import {
  executeWithLastOwnerGuardDisabled,
  withLastOwnerGuardDisabled,
} from '#/shared/db/disable-guard-triggers'
import { createAiAdvisoryScope } from '#/shared/ai-lock-order-v1'

const db = getDb()
let cleanupPool: Pool
const ORG = '30000000-0000-4000-8000-000000000001'
const USER = 'user-merchant-ai-store'
const PROPERTY = '10000000-0000-4000-8000-000000000001'
const CONNECTION = '20000000-0000-4000-8000-000000000001'
const NOW = new Date('2026-08-15T12:00:00.000Z')
const PREVIOUS_NOTICE_VERSION = 'merchant-ai-notice-2026-09-08.v1'
const PREVIOUS_NOTICE_DIGEST =
  'c24030bc98918d3fa6a8e820bf6bca6489a4c8835cf61bd12ab6b84a8f0a0865'

const store = createMerchantAiAuthorizationStore(db, randomUUID)

function command(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORG,
    propertyId: PROPERTY,
    actorUserId: USER,
    idempotencyKey: 'merchant-command-0001',
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
    now: NOW,
    ...overrides,
  }
}

function fence(
  snapshot: MerchantAiSnapshot,
  capability: keyof MerchantAiSnapshot['capabilityEpochs'],
): MerchantAiAuthorizationFence {
  const runtimeProfileVersion = snapshot.capabilityRuntimeProfileVersions[capability]
  if (!snapshot.authorizationLineageId || !runtimeProfileVersion) {
    throw new Error('Test snapshot does not contain an executable authorization fence')
  }
  return {
    authorizationLineageId: snapshot.authorizationLineageId,
    capabilityEpoch: snapshot.capabilityEpochs[capability],
    authorizedSourceEpoch: snapshot.authorizedSourceEpoch,
    stateVersion: snapshot.stateVersion,
    noticeDigest: snapshot.noticeDigest,
    runtimeProfileVersion,
  }
}

async function insertProperty(): Promise<void> {
  await db.execute(sql`
    INSERT INTO properties (
      id, organization_id, name, slug, timezone, lifecycle_state,
      google_connection_id, gbp_account_id, gbp_location_id,
      google_binding_state, profile_source, source_epoch
    ) VALUES (
      ${PROPERTY}::uuid, ${ORG}, 'AI Property', 'ai-property', 'UTC', 'active',
      ${CONNECTION}::uuid, 'account-1', 'location-1',
      'active', 'legacy', 3
    )
  `)
  await db.execute(sql`
    INSERT INTO review_ai_analysis_heads (
      organization_id, property_id, source_epoch, head_sequence
    ) VALUES (${ORG}, ${PROPERTY}::uuid, 3, 7)
  `)
  await db.execute(sql`
    INSERT INTO property_access_grant (
      organization_id, property_id, user_id, source, created_by
    ) VALUES (${ORG}, ${PROPERTY}::uuid, ${USER}, 'operator', ${USER})
  `)
}

async function replaceSourceEpoch(sourceEpoch: number, headSequence = 0): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      UPDATE properties
      SET source_epoch = ${sourceEpoch}
      WHERE organization_id = ${ORG}
        AND id = ${PROPERTY}::uuid
    `)
    await tx.execute(sql`
      INSERT INTO review_ai_analysis_heads (
        organization_id, property_id, source_epoch, head_sequence
      ) VALUES (${ORG}, ${PROPERTY}::uuid, ${sourceEpoch}, ${headSequence})
    `)
  })
}

async function advanceAnalysisHead(): Promise<number> {
  return db.transaction(async (tx) => {
    const scope = createAiAdvisoryScope('provider-source', [ORG, PROPERTY, 3])
    await tx.execute(sql`SELECT pg_advisory_xact_lock(ai_advisory_lock_key_v1(${scope}))`)
    await tx.execute(sql`
      SELECT id
      FROM properties
      WHERE organization_id = ${ORG}
        AND id = ${PROPERTY}::uuid
      FOR UPDATE
    `)
    const result = await tx.execute(sql`
      SELECT lock_review_ai_analysis_head_v1(
        ${ORG}, ${PROPERTY}::uuid, 3
      ) AS head_sequence
    `)
    return Number(result.rows[0]?.head_sequence)
  })
}

async function resetAuthorization(): Promise<void> {
  await db.execute(sql`DELETE FROM outbox_events WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM properties WHERE id = ${PROPERTY}::uuid`)
  await insertProperty()
  await db.execute(sql`
    INSERT INTO member (id, "userId", "organizationId", role, "createdAt")
    VALUES ('member-merchant-ai-store', ${USER}, ${ORG}, 'admin', now())
    ON CONFLICT (id) DO UPDATE SET role = 'admin'
  `)
}

beforeAll(async () => {
  cleanupPool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 1 })
  await withLastOwnerGuardDisabled(cleanupPool, async (client) => {
    await client.query('DELETE FROM member WHERE "organizationId" = $1', [ORG])
  })
  clearEventSchemas()
  registerAllEventSchemas()
  await db.execute(sql`DELETE FROM properties WHERE id = ${PROPERTY}::uuid`)
  await db.execute(sql`DELETE FROM google_connections WHERE id = ${CONNECTION}::uuid`)
  await db.execute(sql`DELETE FROM "user" WHERE id = ${USER}`)
  await deleteTestOrganizations(db, [ORG])
  await db.execute(sql`
    INSERT INTO organization (id, name, slug, "createdAt")
    VALUES (${ORG}, 'Merchant AI Store', ${ORG}, now())
  `)
  await db.execute(sql`
    INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
    VALUES (${USER}, 'Merchant AI Owner', 'merchant-ai-store@example.test', true, now(), now())
  `)
  await db.execute(sql`
    INSERT INTO member (id, "userId", "organizationId", role, "createdAt")
    VALUES ('member-merchant-ai-store', ${USER}, ${ORG}, 'admin', now())
  `)
  await db.execute(sql`
    INSERT INTO google_connections (
      id, organization_id, google_subject, encrypted_access_token,
      encrypted_refresh_token, token_expires_at, scopes, connected_by,
      visibility, status
    ) VALUES (
      ${CONNECTION}::uuid, ${ORG}, 'merchant-ai-store-subject',
      'encrypted-access', 'encrypted-refresh', now() + interval '1 hour',
      ARRAY['https://www.googleapis.com/auth/business.manage'], ${USER},
      'organization', 'active'
    )
  `)
  await insertProperty()
})

beforeEach(async () => {
  await resetAuthorization()
})

afterAll(async () => {
  await db.execute(sql`DELETE FROM outbox_events WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM properties WHERE id = ${PROPERTY}::uuid`)
  await db.execute(sql`DELETE FROM google_connections WHERE id = ${CONNECTION}::uuid`)
  await withLastOwnerGuardDisabled(cleanupPool, async (client) => {
    await client.query('DELETE FROM member WHERE "organizationId" = $1', [ORG])
    await client.query('DELETE FROM "user" WHERE id = $1', [USER])
    await deleteTestOrganizations(client, [ORG])
  })
  await cleanupPool.end()
})

describe('Merchant AI authorization store', () => {
  it('returns null before a merchant makes a choice', async () => {
    await expect(
      store.getSnapshot({ organizationId: ORG, propertyId: PROPERTY }),
    ).resolves.toBeNull()
  })

  it('atomically commits the current head, immutable evidence, exact fence, and identifier-only event', async () => {
    const snapshot = await store.mutate(command())

    expect(snapshot).toMatchObject({
      state: 'enabled',
      stateVersion: 1,
      authorizedSourceEpoch: 3,
      analysisStartSequence: 7,
      capabilityEpochs: {
        review_analysis: 1,
        reply_drafting: 1,
        property_trends: 1,
      },
      capabilities: CURRENT_MERCHANT_AI_CAPABILITIES,
      noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
      providerDeploymentProfileVersion: 'private-beta-global-v1',
    })
    expect(snapshot.authorizationLineageId).toMatch(/^[0-9a-f-]{36}$/)

    await expect(
      hasActiveMerchantAiConsent(db, {
        organizationId: ORG,
        propertyId: PROPERTY,
        purpose: 'ai.analyze',
        expectedFence: fence(snapshot, 'review_analysis'),
      }),
    ).resolves.toBe(true)
    await expect(
      hasActiveMerchantAiConsent(db, {
        organizationId: ORG,
        propertyId: PROPERTY,
        purpose: 'ai.analyze',
        expectedFence: {
          ...fence(snapshot, 'review_analysis'),
          capabilityEpoch: 2,
        },
      }),
    ).resolves.toBe(false)

    const evidence = await db.execute(sql`
      SELECT transition_kind, state, review_analysis_epoch, reply_drafting_epoch,
             property_trends_epoch, authorized_source_epoch,
             analysis_start_sequence, state_version, idempotency_key, notice_digest
      FROM merchant_ai_consent_evidence
      WHERE organization_id = ${ORG}
    `)
    expect(evidence.rows).toEqual([
      expect.objectContaining({
        transition_kind: 'enable',
        state: 'enabled',
        review_analysis_epoch: 1,
        reply_drafting_epoch: 1,
        property_trends_epoch: 1,
        authorized_source_epoch: 3,
        analysis_start_sequence: '7',
        state_version: 1,
        idempotency_key: 'merchant-command-0001',
        notice_digest: MERCHANT_AI_NOTICE_DIGEST,
      }),
    ])
    const outbox = await db.execute(sql`
      SELECT event_type, payload
      FROM outbox_events
      WHERE organization_id = ${ORG}
    `)
    expect(outbox.rows).toEqual([
      expect.objectContaining({
        event_type: 'identity.merchant_ai.changed',
        payload: expect.objectContaining({
          organizationId: ORG,
          propertyId: PROPERTY,
          authorizationLineageId: snapshot.authorizationLineageId,
          reviewAnalysisEpoch: snapshot.capabilityEpochs.review_analysis,
          replyDraftingEpoch: snapshot.capabilityEpochs.reply_drafting,
          propertyTrendsEpoch: snapshot.capabilityEpochs.property_trends,
          authorizedSourceEpoch: 3,
          analysisStartSequence: 7,
          stateVersion: 1,
          state: 'enabled',
        }),
      }),
    ])
    expect(outbox.rows[0]?.payload).not.toHaveProperty('actorUserId')
    expect(outbox.rows[0]?.payload).not.toHaveProperty('capabilities')
  })

  it('creates an explicit zero Review head when enabling analysis on a zero-review Property', async () => {
    await db.execute(sql`
      DELETE FROM review_ai_analysis_heads
      WHERE organization_id = ${ORG}
        AND property_id = ${PROPERTY}::uuid
        AND source_epoch = 3
    `)

    const snapshot = await store.mutate(command())

    expect(snapshot).toMatchObject({
      state: 'enabled',
      authorizedSourceEpoch: 3,
      analysisStartSequence: 0,
    })
    const head = await db.execute(sql`
      SELECT head_sequence
      FROM review_ai_analysis_heads
      WHERE organization_id = ${ORG}
        AND property_id = ${PROPERTY}::uuid
        AND source_epoch = 3
    `)
    expect(head.rows).toEqual([{ head_sequence: '0' }])
  })

  it('does not manufacture a zero frontier when a material Review exists', async () => {
    await db.execute(sql`
      DELETE FROM review_ai_analysis_heads
      WHERE organization_id = ${ORG}
        AND property_id = ${PROPERTY}::uuid
        AND source_epoch = 3
    `)
    await db.execute(sql`
      INSERT INTO reviews (
        id, organization_id, property_id, platform, source_epoch,
        source_revision, analysis_sequence
      ) VALUES (
        '10000000-0000-4000-8000-000000000099'::uuid,
        ${ORG}, ${PROPERTY}::uuid, 'google', 3, 1, 1
      )
    `)

    await expect(store.mutate(command())).rejects.toMatchObject({
      code: 'property_inactive',
      message: 'Current Review analysis source head is unavailable',
    })
    const head = await db.execute(sql`
      SELECT head_sequence
      FROM review_ai_analysis_heads
      WHERE organization_id = ${ORG}
        AND property_id = ${PROPERTY}::uuid
        AND source_epoch = 3
    `)
    expect(head.rows).toEqual([])
  })

  it('serializes zero-review authorization with the first material-revision allocation', async () => {
    await db.execute(sql`
      DELETE FROM review_ai_analysis_heads
      WHERE organization_id = ${ORG}
        AND property_id = ${PROPERTY}::uuid
        AND source_epoch = 3
    `)

    const [enabled, firstSequence] = await Promise.all([
      store.mutate(command()),
      advanceAnalysisHead(),
    ])

    expect(firstSequence).toBe(1)
    expect([0, 1]).toContain(enabled.analysisStartSequence)
    if (enabled.analysisStartSequence === 0) {
      // Authorization won the shared Property lock. The first revision is a
      // live arrival strictly after the captured zero frontier.
      expect(firstSequence).toBe(enabled.analysisStartSequence + 1)
    } else {
      // Review allocation won. The first revision is inside enrollment's
      // immutable first-enablement frontier.
      expect(firstSequence).toBe(enabled.analysisStartSequence)
    }
  })

  it('fails exact consent fences after source, state, notice, or runtime drift', async () => {
    const snapshot = await store.mutate(command())
    const expectedFence = fence(snapshot, 'review_analysis')
    await replaceSourceEpoch(4)

    await expect(
      hasActiveMerchantAiConsent(db, {
        organizationId: ORG,
        propertyId: PROPERTY,
        purpose: 'ai.analyze',
        expectedFence,
      }),
    ).resolves.toBe(false)
    for (const changedFence of [
      { ...expectedFence, stateVersion: expectedFence.stateVersion + 1 },
      { ...expectedFence, noticeDigest: '0'.repeat(64) },
      { ...expectedFence, runtimeProfileVersion: 'wrong-runtime' },
      {
        ...expectedFence,
        authorizationLineageId: '30000000-0000-4000-8000-000000000001',
      },
    ]) {
      await expect(
        hasActiveMerchantAiConsent(db, {
          organizationId: ORG,
          propertyId: PROPERTY,
          purpose: 'ai.analyze',
          expectedFence: changedFence,
        }),
      ).resolves.toBe(false)
    }
  })

  it('replays the exact committed result and rejects a changed idempotent command', async () => {
    const first = await store.mutate(command())
    await expect(store.mutate(command())).resolves.toEqual(first)
    await expect(
      store.mutate(command({ capabilities: ['review_analysis'] })),
    ).rejects.toMatchObject({ code: 'idempotency_conflict' })

    const counts = await db.execute(sql`
      SELECT
        (SELECT count(*)::int FROM merchant_ai_consent_evidence WHERE organization_id = ${ORG}) AS evidence,
        (SELECT count(*)::int FROM outbox_events WHERE organization_id = ${ORG}) AS events
    `)
    expect(counts.rows[0]).toEqual({ evidence: 1, events: 1 })
  })

  it('enforces transition, optimistic-version, and material-change rules', async () => {
    await expect(
      store.mutate(
        command({
          operation: 'change',
          idempotencyKey: 'change-before-enable',
          capabilities: ['review_analysis'],
        }),
      ),
    ).rejects.toMatchObject({ code: 'invalid_transition' })

    await store.mutate(command())
    await expect(
      store.mutate(
        command({
          operation: 'change',
          idempotencyKey: 'stale-change',
          expectedStateVersion: 0,
          capabilities: ['review_analysis'],
        }),
      ),
    ).rejects.toMatchObject({ code: 'version_conflict' })
    await expect(
      store.mutate(
        command({
          operation: 'change',
          idempotencyKey: 'no-op-change',
          expectedStateVersion: 1,
        }),
      ),
    ).rejects.toMatchObject({ code: 'no_op' })
  })

  it('serializes a concurrent Review head advance at the consent watermark', async () => {
    const [enabled, advancedSequence] = await Promise.all([
      store.mutate(command()),
      advanceAnalysisHead(),
    ])

    expect(advancedSequence).toBe(8)
    expect([7, 8]).toContain(enabled.analysisStartSequence)
    if (enabled.analysisStartSequence === 7) {
      // The mutation serialized after consent and is the exact next sequence.
      expect(advancedSequence).toBe(enabled.analysisStartSequence + 1)
    } else {
      // The mutation serialized before consent and is included in the skipped watermark.
      expect(advancedSequence).toBe(enabled.analysisStartSequence)
    }

    const persisted = await store.getSnapshot({
      organizationId: ORG,
      propertyId: PROPERTY,
    })
    expect(persisted?.analysisStartSequence).toBe(enabled.analysisStartSequence)
    const outbox = await db.execute(sql`
      SELECT payload
      FROM outbox_events
      WHERE organization_id = ${ORG}
        AND event_type = 'identity.merchant_ai.changed'
    `)
    expect(outbox.rows[0]?.payload).toMatchObject({
      authorizedSourceEpoch: 3,
      analysisStartSequence: enabled.analysisStartSequence,
      reviewAnalysisEpoch: 1,
    })
  })

  it('resnapshots the current Review head when analysis is enabled again', async () => {
    const enabled = await store.mutate(command())
    const replyOnly = await store.mutate(
      command({
        idempotencyKey: 'reply-only',
        operation: 'change',
        expectedStateVersion: 1,
        capabilities: ['reply_drafting'],
        reasonCode: 'capabilities_changed',
      }),
    )
    expect(replyOnly.analysisStartSequence).toBe(7)
    await db.execute(sql`
      UPDATE review_ai_analysis_heads
      SET head_sequence = 13
      WHERE organization_id = ${ORG}
        AND property_id = ${PROPERTY}::uuid
        AND source_epoch = 3
    `)

    const analysisEnabled = await store.mutate(
      command({
        idempotencyKey: 'analysis-enabled-again',
        operation: 'change',
        expectedStateVersion: 2,
        capabilities: ['review_analysis', 'reply_drafting'],
        reasonCode: 'capabilities_changed',
      }),
    )
    expect(analysisEnabled).toMatchObject({
      authorizationLineageId: enabled.authorizationLineageId,
      analysisStartSequence: 13,
      capabilityEpochs: {
        review_analysis: 3,
        reply_drafting: 1,
        property_trends: 2,
      },
    })
  })

  it('resnapshots the full eligible Review population when notice re-consent advances the analysis epoch', async () => {
    const enabled = await store.mutate(
      command({
        noticeVersion: PREVIOUS_NOTICE_VERSION,
        noticeDigest: PREVIOUS_NOTICE_DIGEST,
      }),
    )
    await db.execute(sql`
      INSERT INTO reviews (
        id, organization_id, property_id, platform, external_id, reviewer_name,
        rating, text, language_code, reviewed_at, content_expires_at,
        source_epoch, source_revision, analysis_sequence, ai_source_byte_length,
        ai_source_digest
      ) VALUES
        (
          '10000000-0000-4000-8000-000000000020'::uuid, ${ORG}, ${PROPERTY}::uuid,
          'google', 'notice-reconsent-review-20', 'Synthetic reviewer', 5,
          'Eligible review twenty', 'en', ${NOW}, '2099-09-10T00:00:00.000Z',
          3, 1, 20, 22, ${'a'.repeat(64)}
        ),
        (
          '10000000-0000-4000-8000-000000000038'::uuid, ${ORG}, ${PROPERTY}::uuid,
          'google', 'notice-reconsent-review-38', 'Synthetic reviewer', 4,
          'Eligible review thirty eight', 'en', ${NOW}, '2099-09-10T00:00:00.000Z',
          3, 1, 38, 28, ${'b'.repeat(64)}
        )
    `)
    await db.execute(sql`
      INSERT INTO ai_property_daily_aggregates (
        organization_id, property_id, local_date, source_epoch,
        review_analysis_epoch, property_profile_version, calendar_profile_version,
        aggregate_revision, terminal_analysis_sequence, review_count, rating_sum,
        positive_count, neutral_count, negative_count, mixed_count, urgent_count,
        high_count, medium_count, low_count, updated_at
      ) VALUES (
        ${ORG}, ${PROPERTY}::uuid, '2026-08-14', 3, 1, 1,
        'property-calendar-v1', 1, 7, 1, 5, 1, 0, 0, 0, 0, 0, 0, 1, ${NOW}
      )
    `)
    await db.execute(sql`
      UPDATE review_ai_analysis_heads
      SET head_sequence = 38
      WHERE organization_id = ${ORG}
        AND property_id = ${PROPERTY}::uuid
        AND source_epoch = 3
    `)

    const reconsented = await store.mutate(
      command({
        operation: 'change',
        idempotencyKey: 'notice-reconsent',
        expectedStateVersion: enabled.stateVersion,
        reasonCode: 'notice_reconsented',
      }),
    )
    const eligible = await db.execute(sql`
      SELECT id
      FROM reviews
      WHERE organization_id = ${ORG}
        AND property_id = ${PROPERTY}::uuid
        AND source_epoch = 3
        AND source_revision >= 1
        AND analysis_sequence <= ${reconsented.analysisStartSequence}
        AND text IS NOT NULL
        AND content_expires_at > transaction_timestamp()
        AND ai_source_byte_length <= ${MAX_AI_REVIEW_SOURCE_CANONICAL_BYTES_V1}
        AND (
          COALESCE(octet_length(text), 0)::bigint
          + COALESCE(octet_length(language_code), 0)::bigint
          + COALESCE(octet_length(reviewer_name), 0)::bigint
        ) <= ${MAX_AI_REVIEW_SOURCE_RAW_BYTES_V1}
      ORDER BY analysis_sequence
    `)

    expect(reconsented).toMatchObject({
      capabilityEpochs: { review_analysis: 2 },
      analysisStartSequence: 38,
    })
    expect(eligible.rows).toEqual([
      { id: '10000000-0000-4000-8000-000000000020' },
      { id: '10000000-0000-4000-8000-000000000038' },
    ])
  })

  it('rejects watermark advancement when the Review Analysis epoch does not advance', async () => {
    const enabled = await store.mutate(command())
    await db.execute(sql`
      UPDATE review_ai_analysis_heads
      SET head_sequence = 38
      WHERE organization_id = ${ORG}
        AND property_id = ${PROPERTY}::uuid
        AND source_epoch = 3
    `)

    await expect(
      db.execute(sql`
        SELECT apply_merchant_ai_transition_v1(
          ${enabled.authorizationLineageId}::uuid,
          ${enabled.stateVersion},
          ${enabled.stateVersion + 1},
          ${ORG},
          ${PROPERTY}::uuid,
          'change',
          'enabled',
          ARRAY['review_analysis', 'property_trends']::text[],
          ${JSON.stringify({
            review_analysis: 'review-analysis-runtime-v1',
            property_trends: 'property-trends-runtime-v1',
          })}::jsonb,
          ${enabled.capabilityEpochs.review_analysis},
          ${enabled.capabilityEpochs.reply_drafting + 1},
          ${enabled.capabilityEpochs.property_trends},
          ${enabled.authorizedSourceEpoch},
          38,
          ${MERCHANT_AI_NOTICE_VERSION},
          ${MERCHANT_AI_NOTICE_DIGEST},
          'google-business-profile-source-policy-v1',
          1,
          'global',
          'private-beta-global-v1',
          'gbp-review-global-v1',
          ${USER},
          'capabilities_changed',
          'invalid-watermark-advance',
          ${'c'.repeat(64)},
          ${NOW}
        )
      `),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        message: 'merchant_ai_invalid_analysis_sequence',
      }),
    })

    const changed = await store.mutate(
      command({
        operation: 'change',
        idempotencyKey: 'valid-unchanged-watermark',
        expectedStateVersion: enabled.stateVersion,
        capabilities: ['review_analysis', 'property_trends'],
        reasonCode: 'capabilities_changed',
      }),
    )
    expect(changed).toMatchObject({
      analysisStartSequence: 7,
      capabilityEpochs: { review_analysis: 1 },
    })
  })

  it('increments only toggled capability epochs and every enabled epoch on source rebind', async () => {
    const initial = await store.mutate(command())
    const reduced = await store.mutate(
      command({
        idempotencyKey: 'capability-reduced',
        operation: 'change',
        expectedStateVersion: 1,
        capabilities: ['review_analysis'],
        reasonCode: 'capabilities_changed',
      }),
    )
    expect(reduced.capabilityEpochs).toEqual({
      review_analysis: 1,
      reply_drafting: 2,
      property_trends: 2,
    })
    const oldFence = fence(reduced, 'review_analysis')

    await replaceSourceEpoch(4, 2)
    await expect(
      hasActiveMerchantAiConsent(db, {
        organizationId: ORG,
        propertyId: PROPERTY,
        purpose: 'ai.analyze',
        expectedFence: oldFence,
      }),
    ).resolves.toBe(false)
    const rebound = await store.mutate(
      command({
        idempotencyKey: 'source-rebound',
        operation: 'change',
        expectedStateVersion: 2,
        capabilities: ['review_analysis'],
        reasonCode: 'source_rebound',
      }),
    )
    expect(rebound).toMatchObject({
      authorizationLineageId: initial.authorizationLineageId,
      authorizedSourceEpoch: 4,
      analysisStartSequence: 2,
      capabilityEpochs: {
        review_analysis: 2,
        reply_drafting: 2,
        property_trends: 2,
      },
    })
  })

  it('revokes after source disconnection without moving the watermark and denies every old fence', async () => {
    const enabled = await store.mutate(command())
    const oldFence = fence(enabled, 'review_analysis')
    await db.execute(sql`
      UPDATE review_ai_analysis_heads
      SET head_sequence = 38
      WHERE organization_id = ${ORG}
        AND property_id = ${PROPERTY}::uuid
        AND source_epoch = 3
    `)
    await db.execute(sql`
      UPDATE properties
      SET lifecycle_state = 'suspended',
          google_binding_state = 'disconnected',
          source_epoch = source_epoch + 1
      WHERE id = ${PROPERTY}::uuid
    `)

    const revoked = await store.mutate(
      command({
        operation: 'revoke',
        idempotencyKey: 'merchant-revoked',
        expectedStateVersion: 1,
        state: 'revoked',
        capabilities: [],
        reasonCode: 'merchant_revoked',
      }),
    )
    expect(revoked).toMatchObject({
      state: 'revoked',
      authorizedSourceEpoch: 3,
      analysisStartSequence: 7,
      capabilityEpochs: {
        review_analysis: 2,
        reply_drafting: 2,
        property_trends: 2,
      },
    })
    await expect(
      hasActiveMerchantAiConsent(db, {
        organizationId: ORG,
        propertyId: PROPERTY,
        purpose: 'ai.analyze',
        expectedFence: oldFence,
      }),
    ).resolves.toBe(false)
  })

  it('fails closed for missing membership, assignment, or active source', async () => {
    await db.execute(sql`DELETE FROM member WHERE "organizationId" = ${ORG}`)
    await expect(store.mutate(command())).rejects.toMatchObject({
      code: 'membership_denied',
    })
    await db.execute(sql`
      INSERT INTO member (id, "userId", "organizationId", role, "createdAt")
      VALUES ('member-merchant-ai-store', ${USER}, ${ORG}, 'member', now())
    `)
    await expect(store.mutate(command())).rejects.toMatchObject({
      code: 'membership_denied',
    })
    await db.execute(sql`
      UPDATE member
      SET role = 'admin'
      WHERE id = 'member-merchant-ai-store'
    `)
    await db.execute(sql`
      DELETE FROM property_access_grant
      WHERE organization_id = ${ORG} AND property_id = ${PROPERTY}::uuid
    `)
    await expect(store.mutate(command())).rejects.toMatchObject({
      code: 'assignment_denied',
    })
    await db.execute(sql`
      INSERT INTO property_access_grant (
        organization_id, property_id, user_id, source, created_by
      ) VALUES (${ORG}, ${PROPERTY}::uuid, ${USER}, 'operator', ${USER})
    `)
    await db.execute(sql`
      UPDATE properties SET lifecycle_state = 'suspended' WHERE id = ${PROPERTY}::uuid
    `)
    await expect(store.mutate(command())).rejects.toMatchObject({
      code: 'property_inactive',
    })
  })

  it('linearizes concurrent stale commands so exactly one transition commits', async () => {
    await store.mutate(command())
    const change = store.mutate(
      command({
        operation: 'change',
        idempotencyKey: 'concurrent-change',
        expectedStateVersion: 1,
        capabilities: ['review_analysis'],
        reasonCode: 'capabilities_changed',
      }),
    )
    const revoke = store.mutate(
      command({
        operation: 'revoke',
        idempotencyKey: 'concurrent-revoke',
        expectedStateVersion: 1,
        state: 'revoked',
        capabilities: [],
        reasonCode: 'merchant_revoked',
      }),
    )
    const outcomes = await Promise.allSettled([change, revoke])

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1)
    const snapshot = await store.getSnapshot({
      organizationId: ORG,
      propertyId: PROPERTY,
    })
    expect(snapshot?.stateVersion).toBe(2)
    expect(['enabled', 'revoked']).toContain(snapshot?.state)
  })

  it('rejects direct head/history mutation and supports a fresh disabled restore reset', async () => {
    const enabled = await store.mutate(command())
    await expect(
      db.execute(sql`
        UPDATE merchant_ai_enablement SET state_version = state_version + 1
        WHERE organization_id = ${ORG}
      `),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        message: 'merchant_ai_head_requires_transition_function',
      }),
    })
    await expect(
      db.execute(sql`
        DELETE FROM merchant_ai_consent_evidence WHERE organization_id = ${ORG}
      `),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ message: 'merchant_ai_history_is_append_only' }),
    })

    const reset = await store.restoreReset({
      organizationId: ORG,
      propertyId: PROPERTY,
      idempotencyKey: 'restore-safety-reset',
      expectedStateVersion: enabled.stateVersion,
      reasonCode: 'restore_safety',
      noticeVersion: MERCHANT_AI_NOTICE_VERSION,
      noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
      sourcePolicyId: 'google-business-profile-source-policy-v1',
      routingPolicyVersion: 1,
      providerDeploymentProfileVersion: 'private-beta-global-v1',
      redactionProfileFamily: 'gbp-review-global-v1',
      now: NOW,
    })
    expect(reset).toMatchObject({
      state: 'disabled',
      capabilities: [],
      capabilityEpochs: {
        review_analysis: 1,
        reply_drafting: 1,
        property_trends: 1,
      },
      stateVersion: 1,
    })
    expect(reset.authorizationLineageId).not.toBe(enabled.authorizationLineageId)
    const evidence = await db.execute(sql`
      SELECT transition_kind, count(*)::int AS count
      FROM merchant_ai_consent_evidence
      WHERE organization_id = ${ORG}
      GROUP BY transition_kind
      ORDER BY transition_kind
    `)
    expect(evidence.rows).toEqual([
      { transition_kind: 'enable', count: 1 },
      { transition_kind: 'restore_reset', count: 1 },
    ])
  })

  it('uses typed store errors', () => {
    expect(new MerchantAiAuthorizationStoreError('version_conflict', 'x')).toMatchObject({
      code: 'version_conflict',
      name: 'MerchantAiAuthorizationStoreError',
    })
  })
})

// Enabling AI on a freshly imported property once failed with
// `Invalid Merchant AI source_epoch row`: the store read the property's
// `source_epoch` with a minimum of 1, while `properties.source_epoch` starts at
// 0 and only advances on a timezone change, a soft delete, or a region move.
// The database guards had already been corrected; these application-layer
// reads had not, and no test covered the transition against a real database,
// so the failure only surfaced when an owner typed their password. Fixtures are
// distinct from the suite above and from the AI foundation adapter suite:
// integration files share one PostgreSQL database and may run concurrently.
const EPOCH_ZERO_ORGANIZATION_ID = 'merchant-ai-epoch-zero-org'
const EPOCH_ZERO_PROPERTY_ID = '73a00000-0000-4000-8000-000000000001'
const EPOCH_ZERO_CONNECTION_ID = '73a00000-0000-4000-8000-000000000002'
const EPOCH_ZERO_ACTOR_USER_ID = 'merchant-ai-epoch-zero-user'
const EPOCH_ZERO_NOW = new Date('2026-08-19T12:00:00.000Z')

describe('Merchant AI authorization store at source epoch 0', () => {
  const db = getDb()
  const store = createMerchantAiAuthorizationStore(db, randomUUID)

  const clear = async () => {
    // Consent evidence is append-only and the enablement row is transition
    // guarded. Each statement runs on its own so a failure cannot poison a
    // transaction and leave the triggers disabled.
    for (const statement of [
      sql`ALTER TABLE merchant_ai_consent_evidence DISABLE TRIGGER USER`,
      sql`ALTER TABLE merchant_ai_enablement DISABLE TRIGGER USER`,
      // Enablement first: it FKs the evidence row it was minted from.
      sql`DELETE FROM merchant_ai_enablement WHERE organization_id = ${EPOCH_ZERO_ORGANIZATION_ID}`,
      sql`DELETE FROM merchant_ai_consent_evidence WHERE organization_id = ${EPOCH_ZERO_ORGANIZATION_ID}`,
      sql`ALTER TABLE merchant_ai_enablement ENABLE TRIGGER USER`,
      sql`ALTER TABLE merchant_ai_consent_evidence ENABLE TRIGGER USER`,
    ]) {
      await db.execute(statement)
    }
    await db.delete(properties).where(eq(properties.id, EPOCH_ZERO_PROPERTY_ID))
    await db.execute(
      sql`DELETE FROM google_connections WHERE organization_id = ${EPOCH_ZERO_ORGANIZATION_ID}`,
    )
    await db.execute(
      sql`DELETE FROM review_ai_analysis_heads WHERE organization_id = ${EPOCH_ZERO_ORGANIZATION_ID}`,
    )
    // `guard_last_owner` refuses to remove the org's only owner, so the fixture
    // teardown has to suspend it the same way the AI store tests do.
    await executeWithLastOwnerGuardDisabled(db, [
      sql`DELETE FROM member WHERE "organizationId" = ${EPOCH_ZERO_ORGANIZATION_ID}`,
    ])
    await db.execute(sql`DELETE FROM "user" WHERE id = ${EPOCH_ZERO_ACTOR_USER_ID}`)
    await deleteTestOrganizations(db, [EPOCH_ZERO_ORGANIZATION_ID])
  }

  beforeAll(async () => {
    await clear()
    // The store writes an outbox row, and the allowlist registry is installed by
    // composition in a running service — not by a bare test process.
    registerAllEventSchemas()
    await db.execute(sql`
      INSERT INTO organization (id, name, slug, "createdAt")
      VALUES (${EPOCH_ZERO_ORGANIZATION_ID}, 'Merchant AI epoch zero', ${EPOCH_ZERO_ORGANIZATION_ID}, ${EPOCH_ZERO_NOW})
    `)
    // The transition takes a `FOR SHARE` lock on the actor's membership row and
    // refuses without one.
    await db.execute(sql`
      INSERT INTO "user" (id, name, email, "emailVerified")
      VALUES (${EPOCH_ZERO_ACTOR_USER_ID}, 'Epoch zero owner', ${`${EPOCH_ZERO_ACTOR_USER_ID}@example.test`}, true)
    `)
    await db.execute(sql`
      INSERT INTO member (id, "organizationId", "userId", role, "createdAt")
      VALUES (${`${EPOCH_ZERO_ACTOR_USER_ID}-member`}, ${EPOCH_ZERO_ORGANIZATION_ID}, ${EPOCH_ZERO_ACTOR_USER_ID}, 'owner', ${EPOCH_ZERO_NOW})
    `)
    // `properties_google_binding_tuple_valid` requires a connection plus account
    // and location ids whenever the binding is `active`, and `enable` refuses a
    // property whose Google source is not active — so the connection lands first.
    await db.execute(sql`
      INSERT INTO google_connections (
        id, organization_id, google_subject, encrypted_access_token,
        encrypted_refresh_token, token_expires_at, scopes, connected_by, status,
        credential_use_state
      ) VALUES (
        ${EPOCH_ZERO_CONNECTION_ID}::uuid, ${EPOCH_ZERO_ORGANIZATION_ID}, 'google-subject-epoch-zero',
        'encrypted-access', 'encrypted-refresh', ${EPOCH_ZERO_NOW},
        ARRAY['https://www.googleapis.com/auth/business.manage']::text[],
        ${EPOCH_ZERO_ACTOR_USER_ID}, 'active', 'active'
      )
    `)
    await db.insert(properties).values({
      id: EPOCH_ZERO_PROPERTY_ID,
      organizationId: EPOCH_ZERO_ORGANIZATION_ID,
      name: 'Epoch zero property',
      slug: 'epoch-zero-property',
      timezone: 'Europe/Sofia',
      countryCode: 'BG',
      profileVersion: 1,
      // The value a freshly imported property carries.
      sourceEpoch: 0,
      googleBindingState: 'active',
      googleConnectionId: EPOCH_ZERO_CONNECTION_ID,
      gbpAccountId: '117637856120281336154',
      gbpLocationId: '15441257785345231365',
    })
    // `enable` fences the analysis watermark against the current head for the
    // authorized epoch, so the head has to exist at epoch 0 as well.
    await db.execute(sql`
      INSERT INTO review_ai_analysis_heads
        (organization_id, property_id, source_epoch, head_sequence, created_at, updated_at)
      VALUES (${EPOCH_ZERO_ORGANIZATION_ID}, ${EPOCH_ZERO_PROPERTY_ID}::uuid, 0, 256, ${EPOCH_ZERO_NOW}, ${EPOCH_ZERO_NOW})
    `)
  })

  afterAll(clear)

  const enableCommand = (idempotencyKey: string) =>
    ({
      organizationId: EPOCH_ZERO_ORGANIZATION_ID,
      propertyId: EPOCH_ZERO_PROPERTY_ID,
      actorUserId: EPOCH_ZERO_ACTOR_USER_ID,
      idempotencyKey,
      expectedStateVersion: 0,
      operation: 'enable' as const,
      state: 'enabled' as const,
      capabilities: ['review_analysis'] as const,
      reasonCode: 'merchant_enabled',
      noticeVersion: MERCHANT_AI_NOTICE_VERSION,
      noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
      sourcePolicyId: 'google-business-profile-source-policy-v1',
      routingPolicyVersion: 1,
      providerDeploymentProfileVersion: 'private-beta-global-v1' as const,
      redactionProfileFamily: 'gbp-review-global-v1',
      now: EPOCH_ZERO_NOW,
    }) satisfies Parameters<typeof store.mutate>[0]

  it('enables AI on a property at the domain default source epoch of 0', async () => {
    const snapshot = await store.mutate(enableCommand('epoch-zero-enable-1'))

    expect(snapshot.state).toBe('enabled')
    expect(snapshot.authorizedSourceEpoch).toBe(0)
    expect(snapshot.capabilities).toEqual(['review_analysis'])

    const enablement = await db.execute(sql`
      SELECT authorized_source_epoch, state, state_version
      FROM merchant_ai_enablement
      WHERE organization_id = ${EPOCH_ZERO_ORGANIZATION_ID} AND property_id = ${EPOCH_ZERO_PROPERTY_ID}::uuid
    `)
    expect(enablement.rows[0]).toMatchObject({
      authorized_source_epoch: 0,
      state: 'enabled',
    })

    // The consent evidence is what the runtime fences every AI operation
    // against, so it has to carry the same epoch.
    const evidence = await db.execute(sql`
      SELECT authorized_source_epoch
      FROM merchant_ai_consent_evidence
      WHERE organization_id = ${EPOCH_ZERO_ORGANIZATION_ID} AND property_id = ${EPOCH_ZERO_PROPERTY_ID}::uuid
    `)
    expect(evidence.rows[0]).toMatchObject({ authorized_source_epoch: 0 })
  })

  it('reads the enabled snapshot back without rejecting its epoch', async () => {
    // The snapshot mapper read `authorized_source_epoch` with a minimum of 1
    // too, so even a successful enable would have made every later read throw.
    const snapshot = await store.getSnapshot({
      organizationId: EPOCH_ZERO_ORGANIZATION_ID,
      propertyId: EPOCH_ZERO_PROPERTY_ID,
    })

    expect(snapshot).toMatchObject({ state: 'enabled', authorizedSourceEpoch: 0 })
  })

  it('replays an identical enable command idempotently', async () => {
    const snapshot = await store.mutate(enableCommand('epoch-zero-enable-1'))

    expect(snapshot).toMatchObject({ state: 'enabled', authorizedSourceEpoch: 0 })
    const evidence = await db.execute(sql`
      SELECT count(*)::int AS rows
      FROM merchant_ai_consent_evidence
      WHERE organization_id = ${EPOCH_ZERO_ORGANIZATION_ID}
    `)
    expect(evidence.rows[0]).toMatchObject({ rows: 1 })
  })
})
