import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { Pool } from 'pg'
import { getDb } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'
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
import { withLastOwnerGuardDisabled } from '#/shared/db/disable-guard-triggers'
import { createAiAdvisoryScope } from '#/shared/ai-lock-order-v1'

const db = getDb()
let cleanupPool: Pool
const ORG = '30000000-0000-4000-8000-000000000001'
const USER = 'user-merchant-ai-store'
const PROPERTY = '10000000-0000-4000-8000-000000000001'
const CONNECTION = '20000000-0000-4000-8000-000000000001'
const NOW = new Date('2026-08-15T12:00:00.000Z')

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
      google_binding_state, profile_source, routing_policy_version,
      processing_region, source_epoch
    ) VALUES (
      ${PROPERTY}::uuid, ${ORG}, 'AI Property', 'ai-property', 'UTC', 'active',
      ${CONNECTION}::uuid, 'account-1', 'location-1',
      'active', 'legacy', 1, 'global', 3
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

  it('revokes after source disconnection, increments all epochs, and denies every old fence', async () => {
    const enabled = await store.mutate(command())
    const oldFence = fence(enabled, 'review_analysis')
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
