import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, inArray, sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { getPool } from '#/shared/db/pool'
import { executeWithLastOwnerGuardDisabled } from '#/shared/db/disable-guard-triggers'
import {
  aiExecutionControlHeads,
  aiCanaryAuthorizationHeads,
  aiAdmissionCostReservations,
  aiAdmissionProductConsumptions,
  aiAdmissionRateWindows,
  aiPropertyAggregateHeads,
  aiPropertyQuotaWindows,
  aiProviderCircuitStates,
  aiOperationAttempts,
  aiExecutionPermits,
  aiExecutionPermitSettlements,
  aiOperations,
  aiPropertyTrendReports,
  aiReviewEventCursors,
  aiPropertyProcessingProfiles,
  merchantAiConsentEvidence,
  merchantAiEnablement,
  reviewAiAnalysisHeads,
  reviews,
} from '#/shared/db/schema'
import { organizationId, propertyId, reviewId, userId } from '#/shared/domain/ids'
import { properties } from '#/shared/db/schema/property.schema'
import { AI_OPERATION_PROFILES } from '#/shared/ai-operation-profiles'
import { createAiOperationIdentity } from '../../domain/rules'
import type { AiExecutionBinding } from '../../domain/types'
import { createAiControlAdapter } from './ai-control.adapter'
import { createAiCanaryAuthorizationAdapter } from './ai-canary-authorization.adapter'
import { createAiOperationStoreAdapter } from './ai-operation-store.adapter'
import { createAiPropertyAggregateStoreAdapter } from './ai-property-aggregate-store.adapter'
import { createAiOutputStoreAdapter } from './ai-output-store.adapter'
import { createPostgresAiAdmissionAuthority } from '../../../../../services/ai-execution-admission/postgres-admission-authority'
import {
  acquireAiReadDeliveryLease,
  assertAiReadDeliveryLease,
  closeAiReadBarrier,
} from './ai-read-barrier.adapter'
import { createAiReviewEventStoreAdapter } from './ai-review-event-store.adapter'

const NOW = Date.parse('2026-08-16T12:00:00.000Z')
const ORGANIZATION_ID = 'ai-operation-store-test-org'
const PROPERTY_ID = '71000000-0000-4000-8000-000000000001'
const UNAVAILABLE_REVIEW_ID = '71000000-0000-4000-8000-000000000005'
const UNAVAILABLE_ORIGIN_EVENT_ID = '71000000-0000-4000-8000-000000000006'
const REVIEW_ID = '71000000-0000-4000-8000-000000000002'
const ORIGIN_EVENT_ID = '71000000-0000-4000-8000-000000000003'
const LINEAGE_ID = '71000000-0000-4000-8000-000000000004'
const NOTICE_DIGEST = '4ae20219b3ba1ae575ccd567ec88f20201c0c47289606c614ac0bead2c3edc6b'
const DIGEST = 'a'.repeat(64)
const SOURCE_PROVENANCE = Object.freeze({ digest: DIGEST, byteCount: 17 })
const REVIEW_OPERATION_PROFILE = AI_OPERATION_PROFILES.find(
  (profile) => profile.profileVersion === 'review-analysis-v1',
)
if (!REVIEW_OPERATION_PROFILE) {
  throw new Error('review-analysis-v1 operation profile is missing')
}
const REVIEW_PROVIDER_PAYLOAD_BYTE_COUNT = 256
const REVIEW_RESERVED_COST_MICROS = Math.floor(
  ((REVIEW_OPERATION_PROFILE.staticTokenBearingBytes +
    REVIEW_PROVIDER_PAYLOAD_BYTE_COUNT) *
    750_000 +
    REVIEW_OPERATION_PROFILE.maxOutputTokens * 4_500_000 +
    999_999) /
    1_000_000,
)
const REVIEW_ADMISSION_LIMITS = Object.freeze({
  sourceBytes: REVIEW_OPERATION_PROFILE.sourceByteLimit,
  providerPayloadBytes: REVIEW_OPERATION_PROFILE.providerPayloadByteLimit,
  preparedRequestBytes: REVIEW_OPERATION_PROFILE.preparedRequestByteLimit,
  responseBytes: REVIEW_OPERATION_PROFILE.responseByteLimit,
  outputTokens: REVIEW_OPERATION_PROFILE.maxOutputTokens,
  costMicros: REVIEW_RESERVED_COST_MICROS,
})

type Fence = Readonly<{ controlId: string; generation: number }>
async function runCanaryOperatorChild(
  args: readonly string[],
  operatorAllowlist: string,
): Promise<Readonly<{ exitCode: number | null; stdout: string; stderr: string }>> {
  const {
    promise,
    resolve: resolveResult,
    reject,
  } = Promise.withResolvers<
    Readonly<{ exitCode: number | null; stdout: string; stderr: string }>
  >()
  const child = spawn(
    resolve(process.cwd(), 'node_modules/.bin/tsx'),
    [resolve(process.cwd(), 'scripts/ops/ai-canary-authorization.ts'), ...args],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        OPS_OPERATOR_IDENTITIES: operatorAllowlist,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk
  })
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk
  })
  child.once('error', reject)
  child.once('close', (exitCode) => {
    resolveResult({ exitCode, stdout, stderr })
  })
  return await promise
}
function identity(
  overrides: Readonly<{
    reviewId?: string
    originEventId?: string
    sourceRevision?: number
    analysisSequence?: number
  }> = {},
) {
  const result = createAiOperationIdentity({
    command: 'analysis',
    organizationId: ORGANIZATION_ID,
    propertyId: PROPERTY_ID,
    actorId: null,
    systemPrincipal: 'review_event_consumer',
    reviewId: overrides.reviewId ?? REVIEW_ID,
    originEventId: overrides.originEventId ?? ORIGIN_EVENT_ID,
    subjectHmac: 'b'.repeat(64),
    subjectHmacKeyVersion: 'ai-subject-hmac-v1',
    sourceEpoch: 2,
    sourceRevision: overrides.sourceRevision ?? 5,
    reviewedAtEpochMillis: NOW - 1_000,
    analysisSequence: overrides.analysisSequence ?? 7,
  })
  if (result.isErr()) throw new Error(result.error.message)
  return result.value
}
function binding(
  fences: Readonly<{
    global: Fence
    provider: Fence
    capability: Fence
  }>,
  sourceRevision = 5,
): AiExecutionBinding {
  return {
    authorizationLineageId: LINEAGE_ID,
    noticeVersion: 'merchant-ai-notice-2026-08-15.v1',
    noticeDigest: NOTICE_DIGEST,
    capabilityFence: { capability: 'review_analysis', reviewAnalysisEpoch: 1 },
    sourceEpoch: 2,
    evaluatedLanguage: 'en',
    concreteReplyLanguage: null,
    languageCatalogueDigest: DIGEST,
    replyLanguageVerifierDigest: null,
    languageScriptConsistencyDigest: null,
    zhOrthographyVerifierDigest: null,
    sourceRevision,
    reviewedAtEpochMillis: NOW - 1_000,
    propertyProfileVersion: 3,
    routingPolicyVersion: 1,
    sourcePolicyId: 'google-business-profile-source-policy-v1',
    sourceCanonicalizerDigest: DIGEST,
    redactionProfileVersion: 'gbp-review-global-v1',
    outputLeakageProfileVersion: null,
    outputLeakageProfileDigest: null,
    replyTemplateCatalogueVersion: null,
    replyTemplateCatalogueDigest: null,
    providerDeploymentProfileVersion: 'private-beta-global-v1',
    operationProfileVersion: 'review-analysis-v1',
    capabilityRuntimeProfileVersion: 'review-analysis-runtime-v1',
    aiSubjectHmacKeyVersion: 'ai-subject-hmac-v1',
    stopFence: {
      globalControlId: fences.global.controlId,
      globalGeneration: fences.global.generation,
      providerControlId: fences.provider.controlId,
      providerGeneration: fences.provider.generation,
      capabilityControlId: fences.capability.controlId,
      capabilityGeneration: fences.capability.generation,
    },
  }
}
function trendIdentity() {
  const result = createAiOperationIdentity({
    command: 'trend',
    organizationId: ORGANIZATION_ID,
    propertyId: PROPERTY_ID,
    actorId: null,
    systemPrincipal: 'property_trend_coordinator',
    sourceEpoch: 2,
    dueLocalDate: '2026-08-16',
    terminalAnalysisSequence: 7,
    aggregateRevision: 5,
  })
  if (result.isErr()) throw new Error(result.error.message)
  return result.value
}

function trendBinding(
  fences: Readonly<{
    global: Fence
    provider: Fence
    trend: Fence
  }>,
): AiExecutionBinding {
  return {
    authorizationLineageId: LINEAGE_ID,
    noticeVersion: 'merchant-ai-notice-2026-08-15.v1',
    noticeDigest: NOTICE_DIGEST,
    capabilityFence: {
      capability: 'property_trends',
      reviewAnalysisEpoch: 1,
      propertyTrendsEpoch: 1,
    },
    sourceEpoch: 2,
    evaluatedLanguage: null,
    concreteReplyLanguage: null,
    languageCatalogueDigest: null,
    replyLanguageVerifierDigest: null,
    languageScriptConsistencyDigest: null,
    zhOrthographyVerifierDigest: null,
    sourceRevision: null,
    reviewedAtEpochMillis: null,
    propertyProfileVersion: 3,
    routingPolicyVersion: 1,
    sourcePolicyId: 'google-business-profile-source-policy-v1',
    sourceCanonicalizerDigest: DIGEST,
    redactionProfileVersion: 'gbp-review-global-v1',
    outputLeakageProfileVersion: null,
    outputLeakageProfileDigest: null,
    replyTemplateCatalogueVersion: null,
    replyTemplateCatalogueDigest: null,
    providerDeploymentProfileVersion: 'private-beta-global-v1',
    operationProfileVersion: 'property-trend-v1',
    capabilityRuntimeProfileVersion: 'property-trends-runtime-v1',
    aiSubjectHmacKeyVersion: null,
    stopFence: {
      globalControlId: fences.global.controlId,
      globalGeneration: fences.global.generation,
      providerControlId: fences.provider.controlId,
      providerGeneration: fences.provider.generation,
      capabilityControlId: fences.trend.controlId,
      capabilityGeneration: fences.trend.generation,
    },
  }
}

describe('AI operation store (real PostgreSQL)', () => {
  const db = getDb()
  const store = createAiOperationStoreAdapter(db)
  let fences: Readonly<{
    global: Fence
    provider: Fence
    capability: Fence
    trend: Fence
  }>

  const clear = async () => {
    await executeWithLastOwnerGuardDisabled(db, [
      sql`ALTER TABLE ai_canary_authorization_heads DISABLE TRIGGER USER`,
      sql`ALTER TABLE ai_canary_authorizations DISABLE TRIGGER USER`,
      sql`DELETE FROM ai_canary_authorization_heads WHERE release_sha IN (${'8'.repeat(40)}, ${'a'.repeat(40)}, ${'c'.repeat(40)}, ${'e'.repeat(40)})`,
      sql`DELETE FROM ai_operations WHERE release_sha IN (${'8'.repeat(40)}, ${'a'.repeat(40)}, ${'c'.repeat(40)}, ${'e'.repeat(40)})`,
      sql`DELETE FROM ai_canary_authorizations WHERE release_sha IN (${'8'.repeat(40)}, ${'a'.repeat(40)}, ${'c'.repeat(40)}, ${'e'.repeat(40)})`,
      sql`ALTER TABLE ai_canary_authorizations ENABLE TRIGGER USER`,
      sql`ALTER TABLE ai_canary_authorization_heads ENABLE TRIGGER USER`,
      sql`ALTER TABLE ai_read_barrier_heads DISABLE TRIGGER USER`,
      sql`DELETE FROM ai_read_barrier_heads WHERE scope_id IN (${ORGANIZATION_ID}, ${PROPERTY_ID}, 'ai-operation-test-read-barrier-actor')`,
      sql`ALTER TABLE ai_read_barrier_heads ENABLE TRIGGER USER`,
      sql`DELETE FROM properties WHERE id = ${PROPERTY_ID}::uuid`,
      sql`DELETE FROM member WHERE "organizationId" = ${ORGANIZATION_ID}`,
      sql`DELETE FROM "user" WHERE id = 'ai-operation-test-actor'`,
      sql`DELETE FROM organization WHERE id = ${ORGANIZATION_ID}`,
    ])
  }

  beforeAll(async () => {
    await clear()
    await db.execute(sql`
      INSERT INTO organization (id, name, slug, "createdAt")
      VALUES (${ORGANIZATION_ID}, 'AI operation store test', ${ORGANIZATION_ID}, ${new Date(NOW)})
    `)
    await db.execute(sql`
      INSERT INTO ai_provider_circuit_states (
        provider_deployment_profile_version, state, consecutive_failures,
        opened_until, updated_at
      ) VALUES ('private-beta-global-v1', 'closed', 0, NULL, ${new Date(NOW)})
      ON CONFLICT (provider_deployment_profile_version)
      DO UPDATE SET state = 'closed', consecutive_failures = 0,
        opened_until = NULL, updated_at = EXCLUDED.updated_at
    `)
    await db.execute(sql`
      INSERT INTO "user" (
        id, name, email, "emailVerified", "createdAt", "updatedAt"
      ) VALUES (
        'ai-operation-test-actor', 'AI operation test actor',
        'ai-operation-test-actor@example.invalid', true,
        ${new Date(NOW)}, ${new Date(NOW)}
      )
    `)
    await db.execute(sql`
      INSERT INTO member (id, "organizationId", "userId", role, "createdAt")
      VALUES (
        'ai-operation-test-member', ${ORGANIZATION_ID},
        'ai-operation-test-actor', 'owner', ${new Date(NOW)}
      )
    `)
    await db.insert(properties).values({
      id: PROPERTY_ID,
      organizationId: ORGANIZATION_ID,
      name: 'AI operation test property',
      slug: 'ai-operation-test-property',
      timezone: 'America/New_York',
      countryCode: 'US',
      processingRegion: 'global',
      sourceEpoch: 2,
    })
    await db.insert(reviews).values({
      id: REVIEW_ID,
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      platform: 'google',
      externalId: 'ai-output-review',
      externalLocationId: 'locations/ai-output',
      rating: 5,
      text: 'Excellent service',
      languageCode: 'en',
      reviewedAt: new Date(NOW - 1_000),
      expiresAt: new Date(NOW + 86_400_000),
      contentExpiresAt: new Date(NOW + 86_400_000),
      sourceEpoch: 2,
      sourceRevision: 5,
      analysisSequence: 7,
      aiSourceByteLength: 17,
      aiSourceDigest: DIGEST,
    })
    await db.execute(sql`
      INSERT INTO organization_capability (
        organization_id, capability, created_by, created_at
      ) VALUES
        (${ORGANIZATION_ID}, 'review_analysis', 'ai-operation-test-actor', ${new Date(NOW)}),
        (${ORGANIZATION_ID}, 'property_trends', 'ai-operation-test-actor', ${new Date(NOW)})
      ON CONFLICT DO NOTHING
    `)
    await db.execute(sql`
      INSERT INTO property_policy (property_id, updated_at)
      VALUES (${PROPERTY_ID}::uuid, ${new Date(NOW)})
      ON CONFLICT (property_id) DO NOTHING
    `)
    const capabilityRuntimeProfileVersions = {
      review_analysis: 'review-analysis-runtime-v1',
      property_trends: 'property-trends-runtime-v1',
    } as const
    await db.insert(reviewAiAnalysisHeads).values({
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      sourceEpoch: 2,
      headSequence: 0,
      updatedAt: new Date(NOW),
    })
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('repkey.merchant_ai_transition', '1', true)`)
      await tx.insert(merchantAiConsentEvidence).values({
        authorizationLineageId: LINEAGE_ID,
        stateVersion: 1,
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        transitionKind: 'enable',
        state: 'enabled',
        capabilities: ['review_analysis', 'property_trends'],
        capabilityRuntimeProfileVersions,
        reviewAnalysisEpoch: 1,
        replyDraftingEpoch: 1,
        propertyTrendsEpoch: 1,
        authorizedSourceEpoch: 2,
        analysisStartSequence: 1,
        noticeVersion: 'merchant-ai-notice-2026-08-15.v1',
        noticeDigest: NOTICE_DIGEST,
        sourcePolicyId: 'google-business-profile-source-policy-v1',
        routingPolicyVersion: 1,
        processingRegion: 'global',
        providerDeploymentProfileVersion: 'private-beta-global-v1',
        redactionProfileFamily: 'gbp-review-global-v1',
        actorUserId: 'ai-operation-test-actor',
        reasonCode: 'merchant_enabled',
        idempotencyKey: 'ai-operation-enable-v1',
        requestHash: '2'.repeat(64),
        occurredAt: new Date(NOW),
      })
      await tx.insert(merchantAiEnablement).values({
        propertyId: PROPERTY_ID,
        organizationId: ORGANIZATION_ID,
        authorizationLineageId: LINEAGE_ID,
        state: 'enabled',
        capabilities: ['review_analysis', 'property_trends'],
        capabilityRuntimeProfileVersions,
        reviewAnalysisEpoch: 1,
        replyDraftingEpoch: 1,
        propertyTrendsEpoch: 1,
        authorizedSourceEpoch: 2,
        analysisStartSequence: 1,
        stateVersion: 1,
        noticeVersion: 'merchant-ai-notice-2026-08-15.v1',
        noticeDigest: NOTICE_DIGEST,
        sourcePolicyId: 'google-business-profile-source-policy-v1',
        routingPolicyVersion: 1,
        processingRegion: 'global',
        providerDeploymentProfileVersion: 'private-beta-global-v1',
        redactionProfileFamily: 'gbp-review-global-v1',
        updatedBy: 'ai-operation-test-actor',
        updatedAt: new Date(NOW),
      })
    })
    await db.insert(aiPropertyProcessingProfiles).values({
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      countryCode: 'US',
      timezone: 'America/New_York',
      processingRegion: 'global',
      sourceEpoch: 2,
      profileVersion: 3,
      providerDeploymentProfileVersion: 'private-beta-global-v1',
      routingPolicyVersion: 1,
      lifecycleState: 'active',
      updatedAt: new Date(NOW),
    })
    const rows = await db
      .select({
        scopeKey: aiExecutionControlHeads.scopeKey,
        controlId: aiExecutionControlHeads.controlId,
        generation: aiExecutionControlHeads.generation,
      })
      .from(aiExecutionControlHeads)
      .where(
        inArray(aiExecutionControlHeads.scopeKey, [
          'global',
          'provider:private-beta-global-v1',
          'capability:review_analysis',
          'capability:property_trends',
        ]),
      )
    const byScope = new Map(rows.map((row) => [row.scopeKey, row]))
    const global = byScope.get('global')
    const provider = byScope.get('provider:private-beta-global-v1')
    const capability = byScope.get('capability:review_analysis')
    const trend = byScope.get('capability:property_trends')
    if (!global || !provider || !capability || !trend) {
      throw new Error('seeded AI controls missing')
    }
    const candidateReleaseSha = 'a'.repeat(40)
    const canaryAuthorizationId = '75000000-0000-4000-8000-000000000001'
    const canaryOperationId = '75000000-0000-4000-8000-000000000002'
    await db.execute(sql`
      INSERT INTO ai_canary_authorizations (
        id, release_sha, canary_profile_version, authorization_generation,
        predecessor_authorization_id, nonce, operator_user_id, state,
        issued_at, expires_at, settled_at
      ) VALUES (
        ${canaryAuthorizationId}::uuid,
        ${candidateReleaseSha},
        'synthetic-canary-v1',
        1,
        NULL,
        ${'b'.repeat(64)},
        'ai-operation-store-test-operator',
        'passed',
        ${new Date(NOW - 1_000)},
        ${new Date(NOW + 60_000)},
        ${new Date(NOW)}
      )
    `)
    await db.execute(sql`
      INSERT INTO ai_operations (
        id, idempotency_scope, idempotency_key, request_fingerprint,
        command, capability, system_principal, release_sha,
        canary_authorization_id, canary_authorization_generation,
        canary_profile_version, provider_deployment_profile_version,
        operation_profile_version, global_control_id,
        global_control_generation, provider_control_id,
        provider_control_generation, capability_control_id,
        capability_control_generation, capability_fences, state,
        execution_attempt, created_at, updated_at, expires_at
      ) VALUES (
        ${canaryOperationId}::uuid,
        'release-canary:test',
        'passed-canary',
        ${'c'.repeat(64)},
        'synthetic_canary',
        NULL,
        'release_canary',
        ${candidateReleaseSha},
        ${canaryAuthorizationId}::uuid,
        1,
        'synthetic-canary-v1',
        'private-beta-global-v1',
        'synthetic-canary-v1',
        ${global.controlId}::uuid,
        ${global.generation},
        ${provider.controlId}::uuid,
        ${provider.generation},
        NULL,
        NULL,
        jsonb_build_array(
          jsonb_build_object('capability', 'review_analysis'),
          jsonb_build_object('capability', 'reply_drafting'),
          jsonb_build_object('capability', 'property_trends')
        ),
        'succeeded',
        1,
        ${new Date(NOW - 1_000)},
        ${new Date(NOW)},
        ${new Date(NOW + 60_000)}
      )
    `)
    await db.execute(sql`
      INSERT INTO ai_canary_authorization_heads (
        release_sha, canary_profile_version, head_id,
        transition_generation, next_authorization_generation,
        current_authorization_id, current_operation_id, current_permit_id,
        state, updated_at
      ) VALUES (
        ${candidateReleaseSha},
        'synthetic-canary-v1',
        '75000000-0000-4000-8000-000000000003'::uuid,
        3,
        2,
        ${canaryAuthorizationId}::uuid,
        ${canaryOperationId}::uuid,
        NULL,
        'passed',
        ${new Date(NOW)}
      )
    `)
    const control = createAiControlAdapter(db)
    const activate = async (
      head: Fence,
      capability: 'review_analysis' | 'property_trends',
    ) => {
      const activated = await control.transition({
        scope: { kind: 'capability', capability },
        providerDeploymentProfileVersion: 'private-beta-global-v1',
        expectedControlId: head.controlId,
        expectedGeneration: head.generation,
        executionState: 'enabled',
        admissionState: 'accepting',
        reasonCode: 'test_canary_passed',
        actorUserId: 'ai-operation-store-test-operator',
        ticketReference: `test-activate-${capability}`,
        candidateReleaseSha,
      })
      if (!activated) throw new Error(`failed to activate ${capability}`)
      return { controlId: activated.controlId, generation: activated.generation }
    }
    const activatedCapability = await activate(capability, 'review_analysis')
    const activatedTrend = await activate(trend, 'property_trends')
    fences = {
      global,
      provider,
      capability: activatedCapability,
      trend: activatedTrend,
    }
  })

  afterAll(clear)

  it('claims one immutable binding and distinguishes replay from conflict', async () => {
    const request = {
      identity: identity(),
      binding: binding(fences),
      idempotencyKey: 'analysis-replay-key',
      requestFingerprint: 'c'.repeat(64),
      sourceProvenance: SOURCE_PROVENANCE,
      nowEpochMillis: NOW,
      expiresAtEpochMillis: NOW + 60_000,
    } as const

    const [first, concurrent] = await Promise.all([
      store.claim(request),
      store.claim(request),
    ])
    expect([first.status, concurrent.status].sort()).toEqual(['created', 'replayed'])
    const operation =
      first.status === 'created'
        ? first.operation
        : concurrent.status === 'created'
          ? concurrent.operation
          : null
    expect(operation).not.toBeNull()
    expect(operation?.binding).toEqual(request.binding)

    await expect(
      store.claim({ ...request, requestFingerprint: 'd'.repeat(64) }),
    ).resolves.toEqual({ status: 'conflict' })
  })

  it('records CAS control history and rejects mismatched replay', async () => {
    const control = createAiControlAdapter(db)
    const heads = await control.readHeads({
      providerDeploymentProfileVersion: 'private-beta-global-v1',
      capability: 'review_analysis',
    })
    const providerHead = heads.find(
      (head) => head.scope.kind === 'provider_deployment_profile',
    )
    if (!providerHead) throw new Error('provider control head missing')

    const transition = {
      scope: providerHead.scope,
      providerDeploymentProfileVersion: 'private-beta-global-v1',
      expectedControlId: providerHead.controlId,
      expectedGeneration: providerHead.generation,
      executionState: 'enabled',
      admissionState: 'draining',
      reasonCode: 'release_drain',
      actorUserId: 'ai-operation-test-actor',
      ticketReference: 'PR3-control-history',
      candidateReleaseSha: null,
    } as const
    const draining = await control.transition(transition)
    expect(draining).toMatchObject({
      controlId: providerHead.controlId,
      generation: providerHead.generation + 1,
      executionState: 'enabled',
      admissionState: 'draining',
    })
    await expect(control.transition(transition)).resolves.toEqual(draining)
    await expect(
      control.transition({ ...transition, reasonCode: 'mismatched_replay' }),
    ).resolves.toBeNull()
    if (!draining) throw new Error('provider control drain failed')

    const restored = await control.transition({
      ...transition,
      expectedGeneration: draining.generation,
      admissionState: 'accepting',
      reasonCode: 'release_restored',
      ticketReference: 'PR3-control-history-restored',
    })
    expect(restored).toMatchObject({
      generation: draining.generation + 1,
      executionState: 'enabled',
      admissionState: 'accepting',
    })
    if (!restored) throw new Error('provider control restore failed')
    fences = {
      ...fences,
      provider: {
        controlId: restored.controlId,
        generation: restored.generation,
      },
    }
  })

  it('invalidates an in-flight read delivery lease before serialization', async () => {
    const actorUserId = userId('ai-operation-test-read-barrier-actor')
    await db.transaction(async (tx) => {
      const input = {
        organizationId: organizationId(ORGANIZATION_ID),
        propertyId: propertyId(PROPERTY_ID),
        actorUserId,
      } as const
      const lease = await acquireAiReadDeliveryLease(tx, input)
      expect(lease).not.toBeNull()
      if (!lease) throw new Error('read delivery lease was not acquired')

      await expect(
        closeAiReadBarrier(tx, {
          scopeKind: 'actor',
          scopeId: actorUserId,
          expectedGeneration: 1,
        }),
      ).resolves.toBe(2)
      await expect(assertAiReadDeliveryLease(tx, { ...input, lease })).resolves.toBe(
        false,
      )
      await expect(acquireAiReadDeliveryLease(tx, input)).resolves.toBeNull()
    })
  })

  it('CAS-claims attempts and records terminal failure', async () => {
    const claimed = await store.claim({
      identity: identity(),
      binding: binding(fences),
      idempotencyKey: 'analysis-execution-key',
      requestFingerprint: 'e'.repeat(64),
      sourceProvenance: SOURCE_PROVENANCE,
      nowEpochMillis: NOW,
      expiresAtEpochMillis: NOW + 60_000,
    })
    if (claimed.status === 'conflict') throw new Error('unexpected conflict')
    const operationId = claimed.operation.id

    const [first, second] = await Promise.all([
      store.claimExecution({ operationId, expectedAttempt: 1, nowEpochMillis: NOW }),
      store.claimExecution({ operationId, expectedAttempt: 1, nowEpochMillis: NOW }),
    ])
    expect([first, second].filter(Boolean)).toHaveLength(1)
    expect([first, second].find(Boolean)).toMatchObject({
      executionPermitId: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      ),
    })

    await expect(
      store.recordFailure({
        operationId,
        expectedAttempt: 1,
        failureCode: 'provider_unavailable',
        retryAtEpochMillis: null,
        failedAtEpochMillis: NOW + 1_000,
      }),
    ).resolves.toBe(true)

    const stored = await store.read({ operationId, command: 'analysis' })
    expect(stored).toMatchObject({
      state: 'failed',
      executionAttempt: 1,
      failureCode: 'provider_unavailable',
    })
    const attempts = await db
      .select()

      .from(aiOperationAttempts)
      .where(eq(aiOperationAttempts.operationId, operationId))
    expect(attempts).toHaveLength(1)
    expect(attempts[0]).toMatchObject({ state: 'failed' })
  })
  it('atomically admits, settles, and exactly replays a property permit', async () => {
    const liveNow = Date.now()
    const liveBinding = binding(fences)
    const claimed = await store.claim({
      identity: identity({ originEventId: '71000000-0000-4000-8000-000000000013' }),
      binding: liveBinding,
      idempotencyKey: 'live-admission-key',
      requestFingerprint: 'f'.repeat(64),
      sourceProvenance: SOURCE_PROVENANCE,
      nowEpochMillis: liveNow,
      expiresAtEpochMillis: liveNow + 60_000,
    })
    if (claimed.status !== 'created') throw new Error('operation claim failed')
    const executing = await store.claimExecution({
      operationId: claimed.operation.id,
      expectedAttempt: 1,
      nowEpochMillis: liveNow + 1,
    })
    if (!executing?.executionPermitId) throw new Error('execution permit was not issued')

    const descriptor = {
      version: 'ai-admission-descriptor-v1' as const,
      subjectKind: 'property' as const,
      route: 'review-analysis' as const,
      operationId: executing.id,
      permitId: executing.executionPermitId,
      attemptNumber: 1,
      sourceDigest: DIGEST,
      preparedDigest: '2'.repeat(64),
      sourceByteCount: SOURCE_PROVENANCE.byteCount,
      preparedByteCount: 256,
      providerPayloadByteCount: 256,
      promptCacheShard: 1,
      limits: REVIEW_ADMISSION_LIMITS,
      callerDeadlineEpochMillis:
        liveNow + REVIEW_OPERATION_PROFILE.requestDeadlineMs - 2_000,
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      internalSubjectId: REVIEW_ID,
      actorId: null,
      binding: liveBinding,
      canaryBinding: null,
      releaseSha: null,
      canaryAuthorizationId: null,
      observedContentExpiresAtEpochMillis: NOW + 86_400_000,
      redactionCountry: 'US',
      redactionProfileVersion: liveBinding.redactionProfileVersion,
      outputLeakageProfileVersion: null,
      outputLeakageProfileDigest: null,
      replyTemplateCatalogueVersion: null,
      replyTemplateCatalogueDigest: null,
    }
    const authority = createPostgresAiAdmissionAuthority({
      pool: getPool(),
      signingKid: 'grant-v1',
    })
    const admitted = await authority.authorizeProperty(descriptor, {
      keyId: 'binding-v1',
      hmac: 'A'.repeat(43),
    })
    if (admitted.status === 'denied') {
      throw new Error(`property admission denied: ${admitted.code}`)
    }
    expect(admitted).toMatchObject({
      status: 'admitted',
      expiresAtEpochMillis: descriptor.callerDeadlineEpochMillis,
    })
    if (admitted.status !== 'admitted') throw new Error('permit admission failed')

    const settlement = {
      operationId: executing.id,
      permitId: executing.executionPermitId,
      attemptNumber: 1,
      nonce: admitted.nonce,
      disposition: 'success' as const,
      reportedDisposition: 'success' as const,
      providerRetryable: false,
      usageKnown: true,
      inputTokens: 100,
      cachedInputTokens: 20,
      outputTokens: 10,
      reasoningTokens: 5,
      retryAfterSeconds: null,
    }
    const settled = await authority.settle(settlement, 'grant-v1')
    expect(settled).toMatchObject({
      status: 'settled',
      disposition: 'success',
      inputTokens: 100,
      outputTokens: 10,
      costMicros: 107,
      settlementState: 'settled',
    })
    await expect(authority.settle(settlement, 'grant-v1')).resolves.toEqual(settled)
    await expect(
      authority.settle(
        {
          ...settlement,
          disposition: 'no_dispatch',
          reportedDisposition: 'no_dispatch',
          usageKnown: false,
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
        },
        'grant-v1',
      ),
    ).resolves.toEqual({ status: 'denied', code: 'settlement_conflict' })
  })

  it('charges retries per attempt but consumes the product quota once', async () => {
    const liveNow = Date.now()
    const liveBinding = binding(fences)
    const claimed = await store.claim({
      identity: identity({ originEventId: '71000000-0000-4000-8000-000000000015' }),
      binding: liveBinding,
      idempotencyKey: 'retry-admission-key',
      requestFingerprint: 'd'.repeat(64),
      sourceProvenance: SOURCE_PROVENANCE,
      nowEpochMillis: liveNow,
      expiresAtEpochMillis: liveNow + 120_000,
    })
    if (claimed.status !== 'created') throw new Error('operation claim failed')
    const authority = createPostgresAiAdmissionAuthority({
      pool: getPool(),
      signingKid: 'grant-v1',
    })
    const descriptorFor = (
      execution: Readonly<{ id: string; executionPermitId: string | null }>,
      attemptNumber: number,
      descriptorBinding: AiExecutionBinding = liveBinding,
    ) => {
      if (!execution.executionPermitId) throw new Error('execution permit was not issued')
      return {
        version: 'ai-admission-descriptor-v1' as const,
        subjectKind: 'property' as const,
        route: 'review-analysis' as const,
        operationId: execution.id,
        permitId: execution.executionPermitId,
        attemptNumber,
        sourceDigest: DIGEST,
        preparedDigest: '2'.repeat(64),
        sourceByteCount: SOURCE_PROVENANCE.byteCount,
        preparedByteCount: 256,
        providerPayloadByteCount: 256,
        promptCacheShard: 1,
        limits: REVIEW_ADMISSION_LIMITS,
        callerDeadlineEpochMillis:
          liveNow + REVIEW_OPERATION_PROFILE.requestDeadlineMs - 2_000,
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        internalSubjectId: REVIEW_ID,
        actorId: null,
        binding: descriptorBinding,
        canaryBinding: null,
        releaseSha: null,
        canaryAuthorizationId: null,
        observedContentExpiresAtEpochMillis: NOW + 86_400_000,
        redactionCountry: 'US',
        redactionProfileVersion: descriptorBinding.redactionProfileVersion,
        outputLeakageProfileVersion: null,
        outputLeakageProfileDigest: null,
        replyTemplateCatalogueVersion: null,
        replyTemplateCatalogueDigest: null,
      }
    }

    const firstExecution = await store.claimExecution({
      operationId: claimed.operation.id,
      expectedAttempt: 1,
      nowEpochMillis: liveNow + 1,
    })
    if (!firstExecution) throw new Error('first execution was not claimed')
    const firstDescriptor = descriptorFor(firstExecution, 1)
    const firstAdmission = await authority.authorizeProperty(firstDescriptor, {
      keyId: 'binding-v1',
      hmac: 'C'.repeat(43),
    })
    if (firstAdmission.status !== 'admitted') {
      throw new Error(`first admission denied: ${firstAdmission.code}`)
    }
    await expect(
      authority.settle(
        {
          operationId: firstExecution.id,
          permitId: firstDescriptor.permitId,
          attemptNumber: 1,
          nonce: firstAdmission.nonce,
          disposition: 'no_dispatch',
          reportedDisposition: 'no_dispatch',
          providerRetryable: false,
          usageKnown: false,
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          retryAfterSeconds: null,
        },
        'grant-v1',
      ),
    ).resolves.toMatchObject({ status: 'settled', settlementState: 'released' })
    await expect(
      store.recordFailure({
        operationId: firstExecution.id,
        expectedAttempt: 1,
        failureCode: 'provider_unavailable',
        failedAtEpochMillis: liveNow + 2,
        retryAtEpochMillis: liveNow + 3,
      }),
    ).resolves.toBe(true)

    const secondExecution = await store.claimExecution({
      operationId: firstExecution.id,
      expectedAttempt: 2,
      nowEpochMillis: liveNow + 3,
    })
    if (!secondExecution) throw new Error('second execution was not claimed')
    const secondDescriptor = descriptorFor(secondExecution, 2)
    await expect(
      authority.authorizeProperty(secondDescriptor, {
        keyId: 'binding-v1',
        hmac: 'D'.repeat(43),
      }),
    ).resolves.toMatchObject({ status: 'admitted' })

    const consumptions = await db
      .select()
      .from(aiAdmissionProductConsumptions)
      .where(eq(aiAdmissionProductConsumptions.operationId, firstExecution.id))
    const reservations = await db
      .select()
      .from(aiAdmissionCostReservations)
      .innerJoin(
        aiExecutionPermits,
        eq(aiAdmissionCostReservations.permitId, aiExecutionPermits.id),
      )
      .where(eq(aiExecutionPermits.operationId, firstExecution.id))
    expect(consumptions).toHaveLength(1)
    expect(reservations).toHaveLength(2)

    const [quotaBeforeTransition] = await db
      .select()
      .from(aiPropertyQuotaWindows)
      .where(eq(aiPropertyQuotaWindows.propertyId, PROPERTY_ID))
    if (!quotaBeforeTransition) throw new Error('property quota window is absent')
    await db
      .update(properties)
      .set({ timezone: 'UTC' })
      .where(eq(properties.id, PROPERTY_ID))
    await db
      .update(aiPropertyProcessingProfiles)
      .set({ timezone: 'UTC', profileVersion: 4, updatedAt: new Date(liveNow + 4) })
      .where(eq(aiPropertyProcessingProfiles.propertyId, PROPERTY_ID))
    const transitionBinding: AiExecutionBinding = {
      ...liveBinding,
      propertyProfileVersion: 4,
    }

    const rateScopes = [
      'global',
      'provider:private-beta-global-v1',
      `organization:${ORGANIZATION_ID}`,
      `property:${PROPERTY_ID}`,
    ]
    const beforeRateRows = await db
      .select()
      .from(aiAdmissionRateWindows)
      .where(inArray(aiAdmissionRateWindows.scopeKey, rateScopes))
    const beforeRates = new Map(
      beforeRateRows.map((row) => [row.scopeKey, row.consumedCount] as const),
    )
    const propertyRateKey = `property:${PROPERTY_ID}`
    const previousPropertyRate = beforeRates.get(propertyRateKey)
    if (previousPropertyRate === undefined)
      throw new Error('property rate window is absent')
    await db
      .update(aiAdmissionRateWindows)
      .set({ consumedCount: 4 })
      .where(eq(aiAdmissionRateWindows.scopeKey, propertyRateKey))

    const limitedClaim = await store.claim({
      identity: identity({ originEventId: '71000000-0000-4000-8000-000000000016' }),
      binding: transitionBinding,
      idempotencyKey: 'atomic-rate-limit-key',
      requestFingerprint: 'e'.repeat(64),
      sourceProvenance: SOURCE_PROVENANCE,
      nowEpochMillis: liveNow + 4,
      expiresAtEpochMillis: liveNow + 120_000,
    })
    if (limitedClaim.status !== 'created') throw new Error('rate-limit claim failed')
    const limitedExecution = await store.claimExecution({
      operationId: limitedClaim.operation.id,
      expectedAttempt: 1,
      nowEpochMillis: liveNow + 5,
    })
    if (!limitedExecution) throw new Error('rate-limit execution was not claimed')
    await expect(
      authority.authorizeProperty(descriptorFor(limitedExecution, 1, transitionBinding), {
        keyId: 'binding-v1',
        hmac: 'E'.repeat(43),
      }),
    ).resolves.toEqual({ status: 'denied', code: 'rate_limited' })

    const [quotaAfterTransition] = await db
      .select()
      .from(aiPropertyQuotaWindows)
      .where(eq(aiPropertyQuotaWindows.propertyId, PROPERTY_ID))
    expect(quotaAfterTransition).toMatchObject({
      generation: quotaBeforeTransition.generation,
      propertyProfileVersion: quotaBeforeTransition.propertyProfileVersion,
      timezone: quotaBeforeTransition.timezone,
      analysisCount: quotaBeforeTransition.analysisCount,
      replyCount: quotaBeforeTransition.replyCount,
      reservedCostMicros: quotaBeforeTransition.reservedCostMicros,
      settledCostMicros: quotaBeforeTransition.settledCostMicros,
      transitionAnchor: quotaBeforeTransition.endsAt,
      pendingTimezone: 'UTC',
      pendingPropertyProfileVersion: 4,
    })
    expect(quotaAfterTransition?.adoptionAt?.getTime()).toBeGreaterThanOrEqual(
      quotaBeforeTransition.endsAt.getTime() + 86_400_000,
    )
    expect(quotaAfterTransition?.endsAt).toEqual(quotaAfterTransition?.adoptionAt)
    if (!quotaAfterTransition?.transitionAnchor || !quotaAfterTransition.adoptionAt) {
      throw new Error('property quota transition was not armed')
    }
    const setCurrentProfile = async (
      timezone: string,
      profileVersion: number,
      updatedAtOffset: number,
    ): Promise<void> => {
      await db.update(properties).set({ timezone }).where(eq(properties.id, PROPERTY_ID))
      await db
        .update(aiPropertyProcessingProfiles)
        .set({
          timezone,
          profileVersion,
          updatedAt: new Date(liveNow + updatedAtOffset),
        })
        .where(eq(aiPropertyProcessingProfiles.propertyId, PROPERTY_ID))
    }
    const authorizeRateLimited = async (
      currentBinding: AiExecutionBinding,
      originEventId: string,
      idempotencyKey: string,
      digestCharacter: string,
      hmacCharacter: string,
      offset: number,
    ): Promise<void> => {
      const operation = await store.claim({
        identity: identity({ originEventId }),
        binding: currentBinding,
        idempotencyKey,
        requestFingerprint: digestCharacter.repeat(64),
        sourceProvenance: SOURCE_PROVENANCE,
        nowEpochMillis: liveNow + offset,
        expiresAtEpochMillis: liveNow + 120_000,
      })
      if (operation.status !== 'created')
        throw new Error('transition operation claim failed')
      const execution = await store.claimExecution({
        operationId: operation.operation.id,
        expectedAttempt: 1,
        nowEpochMillis: liveNow + offset + 1,
      })
      if (!execution) throw new Error('transition execution was not claimed')
      await expect(
        authority.authorizeProperty(descriptorFor(execution, 1, currentBinding), {
          keyId: 'binding-v1',
          hmac: hmacCharacter.repeat(43),
        }),
      ).resolves.toEqual({ status: 'denied', code: 'rate_limited' })
    }
    const readQuota = async () => {
      const [row] = await db
        .select()
        .from(aiPropertyQuotaWindows)
        .where(eq(aiPropertyQuotaWindows.propertyId, PROPERTY_ID))
      if (!row) throw new Error('property quota window is absent')
      return row
    }

    await setCurrentProfile('Europe/Berlin', 5, 6)
    const berlinBinding: AiExecutionBinding = {
      ...liveBinding,
      propertyProfileVersion: 5,
    }
    await authorizeRateLimited(
      berlinBinding,
      '71000000-0000-4000-8000-000000000017',
      'timezone-transition-berlin',
      'a',
      'F',
      6,
    )
    const quotaAfterSecondEdit = await readQuota()
    expect(quotaAfterSecondEdit).toMatchObject({
      generation: quotaBeforeTransition.generation,
      transitionAnchor: quotaAfterTransition.transitionAnchor,
      pendingTimezone: 'Europe/Berlin',
      pendingPropertyProfileVersion: 5,
      analysisCount: quotaBeforeTransition.analysisCount,
      reservedCostMicros: quotaBeforeTransition.reservedCostMicros,
      settledCostMicros: quotaBeforeTransition.settledCostMicros,
    })
    expect(quotaAfterSecondEdit.adoptionAt?.getTime()).toBeGreaterThanOrEqual(
      quotaAfterTransition.adoptionAt.getTime(),
    )

    await setCurrentProfile('America/New_York', 3, 8)
    await authorizeRateLimited(
      liveBinding,
      '71000000-0000-4000-8000-000000000018',
      'timezone-transition-backtrack',
      'b',
      'G',
      8,
    )
    const quotaAfterBacktrack = await readQuota()
    expect(quotaAfterBacktrack).toMatchObject({
      generation: quotaBeforeTransition.generation,
      transitionAnchor: quotaAfterTransition.transitionAnchor,
      pendingTimezone: 'America/New_York',
      pendingPropertyProfileVersion: 3,
      analysisCount: quotaBeforeTransition.analysisCount,
      reservedCostMicros: quotaBeforeTransition.reservedCostMicros,
      settledCostMicros: quotaBeforeTransition.settledCostMicros,
    })
    expect(quotaAfterBacktrack.adoptionAt?.getTime()).toBeGreaterThanOrEqual(
      quotaAfterSecondEdit.adoptionAt?.getTime() ?? 0,
    )

    await setCurrentProfile('UTC', 4, 10)
    await authorizeRateLimited(
      transitionBinding,
      '71000000-0000-4000-8000-000000000019',
      'timezone-transition-final',
      'c',
      'H',
      10,
    )
    const quotaBeforeAdoption = await readQuota()
    expect(quotaBeforeAdoption).toMatchObject({
      generation: quotaBeforeTransition.generation,
      transitionAnchor: quotaAfterTransition.transitionAnchor,
      pendingTimezone: 'UTC',
      pendingPropertyProfileVersion: 4,
    })
    expect(quotaBeforeAdoption.adoptionAt?.getTime()).toBeGreaterThanOrEqual(
      quotaAfterBacktrack.adoptionAt?.getTime() ?? 0,
    )

    const expiredStartsAt = new Date(liveNow - 3 * 86_400_000)
    const expiredAnchor = new Date(liveNow - 2 * 86_400_000)
    const expiredAdoption = new Date(liveNow - 86_400_000)
    await db
      .update(aiPropertyQuotaWindows)
      .set({
        startsAt: expiredStartsAt,
        transitionAnchor: expiredAnchor,
        adoptionAt: expiredAdoption,
        endsAt: expiredAdoption,
      })
      .where(eq(aiPropertyQuotaWindows.propertyId, PROPERTY_ID))
    await authorizeRateLimited(
      transitionBinding,
      '71000000-0000-4000-8000-000000000020',
      'timezone-transition-adopt',
      'd',
      'I',
      12,
    )
    const quotaAfterAdoption = await readQuota()
    expect(quotaAfterAdoption).toMatchObject({
      generation: quotaBeforeTransition.generation + 1,
      propertyProfileVersion: 4,
      timezone: 'UTC',
      transitionAnchor: null,
      adoptionAt: null,
      pendingTimezone: null,
      pendingPropertyProfileVersion: null,
      analysisCount: 0,
      replyCount: 0,
      reservedCostMicros: 0,
      settledCostMicros: 0,
    })
    await authorizeRateLimited(
      transitionBinding,
      '71000000-0000-4000-8000-000000000021',
      'timezone-transition-no-second-reset',
      'e',
      'J',
      14,
    )
    expect((await readQuota()).generation).toBe(quotaAfterAdoption.generation)

    await setCurrentProfile('America/New_York', 3, 16)

    const afterRateRows = await db
      .select()
      .from(aiAdmissionRateWindows)
      .where(inArray(aiAdmissionRateWindows.scopeKey, rateScopes))
    const afterRates = new Map(
      afterRateRows.map((row) => [row.scopeKey, row.consumedCount] as const),
    )
    for (const scope of rateScopes.slice(0, 3)) {
      expect(afterRates.get(scope)).toBe(beforeRates.get(scope))
    }
    expect(afterRates.get(propertyRateKey)).toBe(4)
    await db
      .update(aiAdmissionRateWindows)
      .set({ consumedCount: previousPropertyRate })
      .where(eq(aiAdmissionRateWindows.scopeKey, propertyRateKey))
  })

  it('reaps an unproved consumed permit as ambiguous at reserved cost', async () => {
    const liveNow = Date.now()
    const liveBinding = binding(fences)
    const claimed = await store.claim({
      identity: identity({ originEventId: '71000000-0000-4000-8000-000000000014' }),
      binding: liveBinding,
      idempotencyKey: 'reaped-admission-key',
      requestFingerprint: 'e'.repeat(64),
      sourceProvenance: SOURCE_PROVENANCE,
      nowEpochMillis: liveNow,
      expiresAtEpochMillis: liveNow + 60_000,
    })
    if (claimed.status !== 'created') throw new Error('operation claim failed')
    const executing = await store.claimExecution({
      operationId: claimed.operation.id,
      expectedAttempt: 1,
      nowEpochMillis: liveNow + 1,
    })
    if (!executing?.executionPermitId) throw new Error('execution permit was not issued')
    const descriptor = {
      version: 'ai-admission-descriptor-v1' as const,
      subjectKind: 'property' as const,
      route: 'review-analysis' as const,
      operationId: executing.id,
      permitId: executing.executionPermitId,
      attemptNumber: 1,
      sourceDigest: DIGEST,
      preparedDigest: '2'.repeat(64),
      sourceByteCount: SOURCE_PROVENANCE.byteCount,
      preparedByteCount: 256,
      providerPayloadByteCount: 256,
      promptCacheShard: 1,
      limits: REVIEW_ADMISSION_LIMITS,
      callerDeadlineEpochMillis:
        liveNow + REVIEW_OPERATION_PROFILE.requestDeadlineMs - 2_000,
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      internalSubjectId: REVIEW_ID,
      actorId: null,
      binding: liveBinding,
      canaryBinding: null,
      releaseSha: null,
      canaryAuthorizationId: null,
      observedContentExpiresAtEpochMillis: NOW + 86_400_000,
      redactionCountry: 'US',
      redactionProfileVersion: liveBinding.redactionProfileVersion,
      outputLeakageProfileVersion: null,
      outputLeakageProfileDigest: null,
      replyTemplateCatalogueVersion: null,
      replyTemplateCatalogueDigest: null,
    }
    const authority = createPostgresAiAdmissionAuthority({
      pool: getPool(),
      signingKid: 'grant-v1',
    })
    const requestBinding = { keyId: 'binding-v1', hmac: 'B'.repeat(43) }
    await db
      .update(reviews)
      .set({ aiSourceDigest: 'b'.repeat(64) })
      .where(eq(reviews.id, REVIEW_ID))
    await expect(
      authority.authorizeProperty(descriptor, requestBinding),
    ).resolves.toEqual({
      status: 'denied',
      code: 'source_mismatch',
    })
    await db
      .update(reviews)
      .set({ aiSourceDigest: DIGEST })
      .where(eq(reviews.id, REVIEW_ID))
    await db
      .update(aiProviderCircuitStates)
      .set({ state: 'closed', consecutiveFailures: 4, openedUntil: null })
      .where(
        eq(
          aiProviderCircuitStates.providerDeploymentProfileVersion,
          'private-beta-global-v1',
        ),
      )
    const admitted = await authority.authorizeProperty(descriptor, requestBinding)
    if (admitted.status !== 'admitted') {
      throw new Error(`property admission denied: ${admitted.code}`)
    }
    await db.execute(sql`
      UPDATE ai_execution_permits
      SET concurrency_expires_at = clock_timestamp() - interval '1 second'
      WHERE id = ${executing.executionPermitId}::uuid
    `)

    await expect(authority.reapExpired(10)).resolves.toBe(1)
    const [permit] = await db
      .select()
      .from(aiExecutionPermits)
      .where(eq(aiExecutionPermits.id, executing.executionPermitId))
    const [reservation] = await db
      .select()
      .from(aiAdmissionCostReservations)
      .where(eq(aiAdmissionCostReservations.permitId, executing.executionPermitId))
    const [settlement] = await db
      .select()
      .from(aiExecutionPermitSettlements)
      .where(eq(aiExecutionPermitSettlements.permitId, executing.executionPermitId))
    const [operation] = await db
      .select()
      .from(aiOperations)
      .where(eq(aiOperations.id, executing.id))
    const [circuit] = await db
      .select()
      .from(aiProviderCircuitStates)
      .where(
        eq(
          aiProviderCircuitStates.providerDeploymentProfileVersion,
          'private-beta-global-v1',
        ),
      )

    expect(permit).toMatchObject({ state: 'ambiguous' })
    expect(reservation).toMatchObject({
      state: 'charged',
      actualCostMicros: REVIEW_RESERVED_COST_MICROS,
    })
    expect(settlement).toMatchObject({
      terminalState: 'failed',
      disposition: 'transport_ambiguous',
      costMicros: REVIEW_RESERVED_COST_MICROS,
      settlementState: 'ambiguous',
    })
    expect(circuit).toMatchObject({ state: 'open', consecutiveFailures: 5 })
    expect(operation).toMatchObject({
      state: 'failed',
      failureCode: 'operation_ambiguous',
    })
    await expect(
      authority.settle(
        {
          operationId: executing.id,
          permitId: executing.executionPermitId,
          attemptNumber: 1,
          nonce: admitted.nonce,
          disposition: 'no_dispatch',
          reportedDisposition: 'no_dispatch',
          providerRetryable: false,
          usageKnown: false,
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          retryAfterSeconds: null,
        },
        'grant-v1',
      ),
    ).resolves.toEqual({ status: 'denied', code: 'settlement_conflict' })
  })

  it('records a retry without creating an early second attempt', async () => {
    const claimed = await store.claim({
      identity: identity(),
      binding: binding(fences),
      idempotencyKey: 'analysis-retry-key',
      requestFingerprint: 'f'.repeat(64),
      sourceProvenance: SOURCE_PROVENANCE,
      nowEpochMillis: NOW,
      expiresAtEpochMillis: NOW + 60_000,
    })
    if (claimed.status === 'conflict') throw new Error('unexpected conflict')
    const operationId = claimed.operation.id
    await store.claimExecution({ operationId, expectedAttempt: 1, nowEpochMillis: NOW })
    await expect(
      store.recordFailure({
        operationId,
        expectedAttempt: 1,
        failureCode: 'provider_unavailable',
        failedAtEpochMillis: NOW + 1_000,
        retryAtEpochMillis: NOW + 5_000,
      }),
    ).resolves.toBe(true)

    await expect(
      store.claimExecution({
        operationId,
        expectedAttempt: 2,
        nowEpochMillis: NOW + 4_999,
      }),
    ).resolves.toBeNull()
    await expect(
      store.claimExecution({
        operationId,
        expectedAttempt: 2,
        nowEpochMillis: NOW + 5_000,
      }),
    ).resolves.toMatchObject({ state: 'executing', executionAttempt: 2 })

    const [row] = await db
      .select({ state: aiOperations.state, attempt: aiOperations.executionAttempt })
      .from(aiOperations)
      .where(eq(aiOperations.id, operationId))
    expect(row).toEqual({ state: 'executing', attempt: 2 })
  })

  it('stores one immutable trend report only after provider completion', async () => {
    await db
      .update(reviewAiAnalysisHeads)
      .set({ headSequence: 7, updatedAt: new Date(NOW) })
      .where(eq(reviewAiAnalysisHeads.propertyId, PROPERTY_ID))
    await db.insert(aiReviewEventCursors).values({
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      sourceEpoch: 2,
      reviewAnalysisEpoch: 1,
      analysisStartSequence: 6,
      consumedSequence: 7,
      terminalAnalysisSequence: 7,
      aggregateRevision: 5,
      lastConsumedEventId: ORIGIN_EVENT_ID,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    })
    await db.insert(aiPropertyAggregateHeads).values({
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      sourceEpoch: 2,
      reviewAnalysisEpoch: 1,
      propertyProfileVersion: 3,
      aggregateRevision: 5,
      terminalAnalysisSequence: 7,
      updatedAt: new Date(NOW),
    })

    const claimed = await store.claim({
      identity: trendIdentity(),
      binding: trendBinding(fences),
      idempotencyKey: 'trend-output-key',
      requestFingerprint: '9'.repeat(64),
      sourceProvenance: { digest: DIGEST, byteCount: 128 },
      nowEpochMillis: NOW,
      expiresAtEpochMillis: NOW + 60_000,
    })
    if (claimed.status === 'conflict') throw new Error('unexpected conflict')
    const operationId = claimed.operation.id
    const outputStore = createAiOutputStoreAdapter(db)
    const report = {
      operationId,
      providerCompletion: {
        expectedAttempt: 1,
        modelSnapshot: 'gpt-5.4-mini-2026-03-17',
        inputTokens: 20,
        outputTokens: 4,
        completedAtEpochMillis: NOW + 1,
      },
      organizationId: organizationId(ORGANIZATION_ID),
      propertyId: propertyId(PROPERTY_ID),
      sourceEpoch: 2,
      reviewAnalysisEpoch: 1,
      propertyTrendsEpoch: 1,
      propertyProfileVersion: 3,
      dueLocalDate: '2026-08-16',
      terminalAnalysisSequence: 7,
      aggregateRevision: 5,
      reportProfileVersion: 'property-trend-v1',
      report: {
        signalKey: 'service_sentiment',
        direction: 'improving',
        confidenceBasisPoints: 8_750,
        supportingReviewCount: 12,
      },
      generatedAtEpochMillis: NOW,
      expiresAtEpochMillis: NOW + 86_400_000,
    } as const

    await expect(outputStore.storeTrendReport(report)).resolves.toBe(false)
    await expect(
      store.claimExecution({ operationId, expectedAttempt: 1, nowEpochMillis: NOW }),
    ).resolves.toMatchObject({ state: 'executing', executionAttempt: 1 })
    await expect(outputStore.storeTrendReport(report)).resolves.toBe(true)
    await expect(outputStore.storeTrendReport(report)).resolves.toBe(false)

    const [stored] = await db
      .select({
        signalKey: aiPropertyTrendReports.signalKey,
        direction: aiPropertyTrendReports.direction,
        confidenceBasisPoints: aiPropertyTrendReports.confidenceBasisPoints,
        supportingReviewCount: aiPropertyTrendReports.supportingReviewCount,
      })
      .from(aiPropertyTrendReports)
      .where(eq(aiPropertyTrendReports.operationId, operationId))
      .limit(1)
    expect(stored).toEqual(report.report)
    await expect(
      outputStore.readTrendReportForDelivery(
        {
          organizationId: report.organizationId,
          actorUserId: userId('ai-operation-test-trend-reader'),
          propertyId: report.propertyId,
          sourceEpoch: report.sourceEpoch,
          reviewAnalysisEpoch: report.reviewAnalysisEpoch,
          propertyTrendsEpoch: report.propertyTrendsEpoch,
          propertyProfileVersion: report.propertyProfileVersion,
          reportProfileVersion: report.reportProfileVersion,
          nowEpochMillis: NOW + 2,
        },
        async (_lease, result) => result,
      ),
    ).resolves.toMatchObject({
      status: 'ready',
      dueLocalDate: '2026-08-16',
      terminalAnalysisSequence: 7,
      aggregateRevision: 5,
      report: report.report,
    })
  })

  it('stores one immutable analysis and reads it only through a delivery lease', async () => {
    await db
      .insert(reviews)
      .values({
        id: REVIEW_ID,
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        platform: 'google',
        externalId: 'ai-output-review',
        externalLocationId: 'locations/ai-output',
        rating: 5,
        text: 'Excellent service',
        languageCode: 'en',
        reviewedAt: new Date(NOW - 1_000),
        expiresAt: new Date(NOW + 86_400_000),
        contentExpiresAt: new Date(NOW + 86_400_000),
        sourceEpoch: 2,
        sourceRevision: 5,
        analysisSequence: 7,
        aiSourceByteLength: 17,
        aiSourceDigest: DIGEST,
      })
      .onConflictDoNothing()
    const claimed = await store.claim({
      identity: identity(),
      binding: binding(fences),
      idempotencyKey: 'analysis-output-key',
      requestFingerprint: '1'.repeat(64),
      sourceProvenance: SOURCE_PROVENANCE,
      nowEpochMillis: NOW,
      expiresAtEpochMillis: NOW + 60_000,
    })
    if (claimed.status === 'conflict') throw new Error('unexpected conflict')
    const operation = claimed.operation
    if (
      operation.identity.command !== 'analysis' ||
      !('authorizationLineageId' in operation.binding)
    ) {
      throw new Error('analysis operation binding missing')
    }
    const outputStore = createAiOutputStoreAdapter(db)
    const analysis = {
      operationId: operation.id,
      providerCompletion: {
        expectedAttempt: 1,
        modelSnapshot: 'gpt-5.4-mini-2026-03-17',
        inputTokens: 18,
        outputTokens: 3,
        completedAtEpochMillis: NOW + 1,
      },
      organizationId: organizationId(operation.identity.organizationId),
      propertyId: propertyId(operation.identity.propertyId),
      reviewId: reviewId(operation.identity.reviewId),
      sourceEpoch: operation.identity.sourceEpoch,
      sourceRevision: operation.identity.sourceRevision,
      analysisSequence: operation.identity.analysisSequence,
      authorizationLineageId: operation.binding.authorizationLineageId,
      reviewAnalysisEpoch: 1,
      propertyProfileVersion: operation.binding.propertyProfileVersion,
      analysisProfileVersion: operation.binding.operationProfileVersion,
      result: {
        status: 'ready',
        derivative: {
          sentiment: 'positive',
          primaryCategory: 'service',
          attention: 'low',
        },
      },
      generatedAtEpochMillis: NOW,
      expiresAtEpochMillis: NOW + 60_000,
    } as const

    await expect(outputStore.storeAnalysis(analysis)).resolves.toBe(false)
    await expect(
      store.claimExecution({
        operationId: operation.id,
        expectedAttempt: 1,
        nowEpochMillis: NOW,
      }),
    ).resolves.toMatchObject({ state: 'executing', executionAttempt: 1 })

    await expect(outputStore.storeAnalysis(analysis)).resolves.toBe(true)
    await expect(outputStore.storeAnalysis(analysis)).resolves.toBe(false)
    await expect(
      outputStore.readAnalysisForDelivery(
        {
          organizationId: analysis.organizationId,
          actorUserId: userId('ai-operation-test-actor'),
          propertyId: analysis.propertyId,
          reviewId: analysis.reviewId,
          authorizationLineageId: analysis.authorizationLineageId,
          reviewAnalysisEpoch: analysis.reviewAnalysisEpoch,
          sourceEpoch: analysis.sourceEpoch,
          sourceRevision: analysis.sourceRevision,
          analysisSequence: analysis.analysisSequence,
          propertyProfileVersion: analysis.propertyProfileVersion,
          analysisProfileVersion: analysis.analysisProfileVersion,
          nowEpochMillis: NOW + 1,
        },
        async (lease, result) => {
          expect(Object.getPrototypeOf(lease)).toBeNull()
          return result
        },
      ),
    ).resolves.toMatchObject({
      status: 'ready',
      sentiment: 'positive',
      primaryCategory: 'service',
      attention: 'low',
      analysisProfileVersion: 'review-analysis-v1',
    })

    await db.insert(reviews).values({
      id: UNAVAILABLE_REVIEW_ID,
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      platform: 'google',
      externalId: 'ai-output-unavailable-review',
      externalLocationId: 'locations/ai-output',
      rating: 3,
      text: '言語は対象外です',
      languageCode: 'ja',
      reviewedAt: new Date(NOW - 1_000),
      expiresAt: new Date(NOW + 86_400_000),
      contentExpiresAt: new Date(NOW + 86_400_000),
      sourceEpoch: 2,
      sourceRevision: 6,
      analysisSequence: 8,
      aiSourceByteLength: 27,
      aiSourceDigest: DIGEST,
    })
    const unavailableClaim = await store.claim({
      identity: identity({
        reviewId: UNAVAILABLE_REVIEW_ID,
        originEventId: UNAVAILABLE_ORIGIN_EVENT_ID,
        sourceRevision: 6,
        analysisSequence: 8,
      }),
      binding: binding(fences, 6),
      idempotencyKey: 'analysis-unavailable-output-key',
      requestFingerprint: '2'.repeat(64),
      sourceProvenance: { digest: DIGEST, byteCount: 27 },
      nowEpochMillis: NOW,
      expiresAtEpochMillis: NOW + 60_000,
    })
    if (unavailableClaim.status === 'conflict') throw new Error('unexpected conflict')
    const unavailableOperation = unavailableClaim.operation
    if (
      unavailableOperation.identity.command !== 'analysis' ||
      !('authorizationLineageId' in unavailableOperation.binding)
    ) {
      throw new Error('unavailable analysis binding missing')
    }
    await store.claimExecution({
      operationId: unavailableOperation.id,
      expectedAttempt: 1,
      nowEpochMillis: NOW,
    })
    const unavailableAnalysis = {
      operationId: unavailableOperation.id,
      providerCompletion: {
        expectedAttempt: 1,
        modelSnapshot: 'gpt-5.4-mini-2026-03-17',
        inputTokens: 15,
        outputTokens: 1,
        completedAtEpochMillis: NOW + 1,
      },
      organizationId: organizationId(unavailableOperation.identity.organizationId),
      propertyId: propertyId(unavailableOperation.identity.propertyId),
      reviewId: reviewId(unavailableOperation.identity.reviewId),
      sourceEpoch: unavailableOperation.identity.sourceEpoch,
      sourceRevision: unavailableOperation.identity.sourceRevision,
      analysisSequence: unavailableOperation.identity.analysisSequence,
      authorizationLineageId: unavailableOperation.binding.authorizationLineageId,
      reviewAnalysisEpoch: 1,
      propertyProfileVersion: unavailableOperation.binding.propertyProfileVersion,
      analysisProfileVersion: unavailableOperation.binding.operationProfileVersion,
      result: { status: 'unavailable', reason: 'language_not_supported' },
      generatedAtEpochMillis: NOW,
      expiresAtEpochMillis: NOW + 60_000,
    } as const
    await expect(outputStore.storeAnalysis(unavailableAnalysis)).resolves.toBe(false)
    const reviewEvents = createAiReviewEventStoreAdapter(db)
    await expect(
      reviewEvents.consumeNext({
        organizationId: unavailableAnalysis.organizationId,
        propertyId: unavailableAnalysis.propertyId,
        sourceEpoch: 2,
        reviewAnalysisEpoch: 1,
        analysisStartSequence: 6,
        analysisSequence: 9,
        eventEnvelopeId: '71000000-0000-4000-8000-000000000009',
        disposition: 'pending',
      }),
    ).resolves.toEqual({ status: 'gap', expectedSequence: 8 })
    const event = {
      organizationId: unavailableAnalysis.organizationId,
      propertyId: unavailableAnalysis.propertyId,
      sourceEpoch: 2,
      reviewAnalysisEpoch: 1,
      analysisStartSequence: 6,
      analysisSequence: 8,
      eventEnvelopeId: UNAVAILABLE_ORIGIN_EVENT_ID,
      disposition: 'pending',
    } as const
    await expect(reviewEvents.consumeNext(event)).resolves.toEqual({
      status: 'accepted',
      consumedSequence: 8,
      terminalAnalysisSequence: 7,
    })
    await expect(reviewEvents.consumeNext(event)).resolves.toEqual({
      status: 'duplicate',
      consumedSequence: 8,
      terminalAnalysisSequence: 7,
    })
    await db
      .update(reviewAiAnalysisHeads)
      .set({ headSequence: 8, updatedAt: new Date(NOW + 1) })
      .where(eq(reviewAiAnalysisHeads.propertyId, PROPERTY_ID))
    await expect(outputStore.storeAnalysis(unavailableAnalysis)).resolves.toBe(true)
    await expect(
      reviewEvents.settleOutcome({
        organizationId: unavailableAnalysis.organizationId,
        propertyId: unavailableAnalysis.propertyId,
        sourceEpoch: 2,
        reviewAnalysisEpoch: 1,
        analysisSequence: 8,
        state: 'ready',
        operationId: unavailableOperation.id,
        dispositionCode: null,
      }),
    ).resolves.toEqual({ terminalAnalysisSequence: 8, aggregateRevision: 5 })

    const aggregates = createAiPropertyAggregateStoreAdapter(db)
    const aggregateInput = {
      organizationId: unavailableAnalysis.organizationId,
      propertyId: unavailableAnalysis.propertyId,
      reviewId: unavailableAnalysis.reviewId,
      sourceEpoch: 2,
      sourceRevision: 6,
      analysisSequence: 8,
      reviewAnalysisEpoch: 1,
      propertyProfileVersion: 3,
      calendarProfileVersion: 'property-calendar-v1',
    } as const
    await expect(aggregates.applyReviewAnalysis(aggregateInput)).resolves.toEqual({
      status: 'applied',
      aggregateRevision: 6,
    })
    await expect(aggregates.applyReviewAnalysis(aggregateInput)).resolves.toEqual({
      status: 'replayed',
      aggregateRevision: 6,
    })
    await expect(
      outputStore.readAnalysisForDelivery(
        {
          organizationId: unavailableAnalysis.organizationId,
          actorUserId: userId('ai-operation-test-actor'),
          propertyId: unavailableAnalysis.propertyId,
          reviewId: unavailableAnalysis.reviewId,
          authorizationLineageId: unavailableAnalysis.authorizationLineageId,
          reviewAnalysisEpoch: unavailableAnalysis.reviewAnalysisEpoch,
          sourceEpoch: unavailableAnalysis.sourceEpoch,
          sourceRevision: unavailableAnalysis.sourceRevision,
          analysisSequence: unavailableAnalysis.analysisSequence,
          propertyProfileVersion: unavailableAnalysis.propertyProfileVersion,
          analysisProfileVersion: unavailableAnalysis.analysisProfileVersion,
          nowEpochMillis: NOW + 1,
        },
        async (_lease, result) => result,
      ),
    ).resolves.toMatchObject({
      status: 'unavailable',
      reason: 'language_not_supported',
      analysisSequence: 8,
    })
    await expect(
      aggregates.readWindow({
        organizationId: unavailableAnalysis.organizationId,
        propertyId: unavailableAnalysis.propertyId,
        sourceEpoch: 2,
        reviewAnalysisEpoch: 1,
        propertyProfileVersion: 3,
        startLocalDate: '2026-08-16',
        endLocalDate: '2026-08-16',
      }),
    ).resolves.toMatchObject({
      head: { terminalAnalysisSequence: 8, aggregateRevision: 6 },
      days: [],
    })
    await expect(
      outputStore.readTrendReportForDelivery(
        {
          organizationId: unavailableAnalysis.organizationId,
          actorUserId: userId('ai-operation-test-trend-reader'),
          propertyId: unavailableAnalysis.propertyId,
          sourceEpoch: 2,
          reviewAnalysisEpoch: 1,
          propertyTrendsEpoch: 1,
          propertyProfileVersion: 3,
          reportProfileVersion: 'property-trend-v1',
          nowEpochMillis: NOW + 2,
        },
        async (_lease, result) => result,
      ),
    ).resolves.toEqual({
      status: 'snapshot_superseded',
      sourceEpoch: 2,
      reviewAnalysisEpoch: 1,
      propertyTrendsEpoch: 1,
      propertyProfileVersion: 3,
      terminalAnalysisSequence: 8,
      aggregateRevision: 6,
    })
    const noResultEvent = {
      organizationId: unavailableAnalysis.organizationId,
      propertyId: unavailableAnalysis.propertyId,
      sourceEpoch: 2,
      reviewAnalysisEpoch: 1,
      analysisStartSequence: 6,
      analysisSequence: 9,
      eventEnvelopeId: '71000000-0000-4000-8000-000000000009',
      disposition: 'provider_deleted',
    } as const
    await expect(reviewEvents.consumeNext(noResultEvent)).resolves.toEqual({
      status: 'accepted',
      consumedSequence: 9,
      terminalAnalysisSequence: 9,
    })
    await db
      .update(reviewAiAnalysisHeads)
      .set({ headSequence: 9, updatedAt: new Date(NOW + 2) })
      .where(eq(reviewAiAnalysisHeads.propertyId, PROPERTY_ID))
    const noResultInput = {
      organizationId: unavailableAnalysis.organizationId,
      propertyId: unavailableAnalysis.propertyId,
      sourceEpoch: 2,
      analysisSequence: 9,
      reviewAnalysisEpoch: 1,
      propertyProfileVersion: 3,
      dispositionCode: 'provider_deleted',
    } as const
    await expect(aggregates.advanceWithoutAnalysis(noResultInput)).resolves.toEqual({
      status: 'applied',
      aggregateRevision: 7,
    })
    await expect(aggregates.advanceWithoutAnalysis(noResultInput)).resolves.toEqual({
      status: 'replayed',
      aggregateRevision: 7,
    })
    await expect(
      aggregates.readWindow({
        organizationId: unavailableAnalysis.organizationId,
        propertyId: unavailableAnalysis.propertyId,
        sourceEpoch: 2,
        reviewAnalysisEpoch: 1,
        propertyProfileVersion: 3,
        startLocalDate: '2026-08-16',
        endLocalDate: '2026-08-16',
      }),
    ).resolves.toMatchObject({
      head: { terminalAnalysisSequence: 9, aggregateRevision: 7 },
      days: [],
    })

    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('repkey.merchant_ai_transition', '1', true)`)
      const revoked = {
        authorizationLineageId: LINEAGE_ID,
        stateVersion: 2,
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        transitionKind: 'revoke',
        state: 'revoked',
        capabilities: [],
        capabilityRuntimeProfileVersions: {},
        reviewAnalysisEpoch: 2,
        replyDraftingEpoch: 1,
        propertyTrendsEpoch: 2,
        authorizedSourceEpoch: 2,
        analysisStartSequence: 1,
        noticeVersion: 'merchant-ai-notice-2026-08-15.v1',
        noticeDigest: NOTICE_DIGEST,
        sourcePolicyId: 'google-business-profile-source-policy-v1',
        routingPolicyVersion: 1,
        processingRegion: 'global',
        providerDeploymentProfileVersion: 'private-beta-global-v1',
        redactionProfileFamily: 'gbp-review-global-v1',
      }
      await tx.insert(merchantAiConsentEvidence).values({
        ...revoked,
        actorUserId: 'ai-operation-test-actor',
        reasonCode: 'merchant_revoked',
        idempotencyKey: 'ai-operation-revoke-v2',
        requestHash: '3'.repeat(64),
        occurredAt: new Date(NOW + 2),
      })
      await tx
        .update(merchantAiEnablement)
        .set({
          ...revoked,
          updatedBy: 'ai-operation-test-actor',
          updatedAt: new Date(NOW + 2),
        })
        .where(eq(merchantAiEnablement.propertyId, PROPERTY_ID))
    })
    await expect(
      outputStore.readAnalysisForDelivery(
        {
          organizationId: analysis.organizationId,
          actorUserId: userId('ai-operation-test-actor'),
          propertyId: analysis.propertyId,
          reviewId: analysis.reviewId,
          authorizationLineageId: analysis.authorizationLineageId,
          reviewAnalysisEpoch: analysis.reviewAnalysisEpoch,
          sourceEpoch: analysis.sourceEpoch,
          sourceRevision: analysis.sourceRevision,
          analysisSequence: analysis.analysisSequence,
          propertyProfileVersion: analysis.propertyProfileVersion,
          analysisProfileVersion: analysis.analysisProfileVersion,
          nowEpochMillis: NOW + 3,
        },
        async (_lease, result) => result,
      ),
    ).resolves.toEqual({ status: 'disabled' })
  })

  it('atomically issues and terminalizes bounded canary generations before admission', async () => {
    const control = createAiControlAdapter(db)
    await db
      .update(aiProviderCircuitStates)
      .set({ state: 'closed', consecutiveFailures: 0, openedUntil: null })
      .where(
        eq(
          aiProviderCircuitStates.providerDeploymentProfileVersion,
          'private-beta-global-v1',
        ),
      )
    const allHeads = await db
      .select()
      .from(aiExecutionControlHeads)
      .where(
        inArray(aiExecutionControlHeads.scopeKey, [
          'global',
          'provider:private-beta-global-v1',
          'capability:review_analysis',
          'capability:reply_drafting',
          'capability:property_trends',
        ]),
      )
    const byScope = new Map(allHeads.map((head) => [head.scopeKey, head]))
    const killCapability = async (
      capability: 'review_analysis' | 'reply_drafting' | 'property_trends',
    ): Promise<Fence> => {
      const head = byScope.get(`capability:${capability}`)
      if (!head) throw new Error(`missing ${capability} control`)
      if (head.executionState === 'killed' && head.admissionState === 'draining') {
        return { controlId: head.controlId, generation: head.generation }
      }
      const killed = await control.transition({
        scope: { kind: 'capability', capability },
        providerDeploymentProfileVersion: 'private-beta-global-v1',
        expectedControlId: head.controlId,
        expectedGeneration: head.generation,
        executionState: 'killed',
        admissionState: 'draining',
        reasonCode: 'canary_test_kill',
        actorUserId: 'ai-operation-test-actor',
        ticketReference: `canary-test-kill-${capability}`,
        candidateReleaseSha: null,
      })
      if (!killed) throw new Error(`failed to kill ${capability}`)
      return { controlId: killed.controlId, generation: killed.generation }
    }
    const [reviewFence, replyFence, trendFence] = await Promise.all([
      killCapability('review_analysis'),
      killCapability('reply_drafting'),
      killCapability('property_trends'),
    ])
    const globalHead = byScope.get('global')
    const providerHead = byScope.get('provider:private-beta-global-v1')
    if (!globalHead || !providerHead) throw new Error('missing canary parent controls')

    const stopFence = {
      globalControlId: globalHead.controlId,
      globalGeneration: globalHead.generation,
      providerControlId: providerHead.controlId,
      providerGeneration: providerHead.generation,
      allCapabilityStopFences: [
        {
          capability: 'review_analysis' as const,
          capabilityControlId: reviewFence.controlId,
          capabilityGeneration: reviewFence.generation,
        },
        {
          capability: 'reply_drafting' as const,
          capabilityControlId: replyFence.controlId,
          capabilityGeneration: replyFence.generation,
        },
        {
          capability: 'property_trends' as const,
          capabilityControlId: trendFence.controlId,
          capabilityGeneration: trendFence.generation,
        },
      ] as const,
    }
    const authorizations = createAiCanaryAuthorizationAdapter(db)
    const lifecycleReleaseSha = 'c'.repeat(40)
    const issueGenerationOne = {
      releaseSha: lifecycleReleaseSha,
      canaryProfileVersion: 'synthetic-canary-v1' as const,
      expected: { headGeneration: 1, stopFence },
      nonce: 'c'.repeat(64),
      operatorUserId: 'ai-operation-test-actor',
    }
    await expect(
      authorizations.issue({
        ...issueGenerationOne,
        expected: { headGeneration: 2, stopFence },
      }),
    ).resolves.toEqual({ status: 'denied' })
    const [headAfterStaleFirstIssue] = await db
      .select()
      .from(aiCanaryAuthorizationHeads)
      .where(eq(aiCanaryAuthorizationHeads.releaseSha, lifecycleReleaseSha))
    expect(headAfterStaleFirstIssue).toBeUndefined()
    await expect(
      authorizations.issue({
        ...issueGenerationOne,
        releaseSha: '9'.repeat(40),
        operatorUserId: 'bad\u0000operator',
      }),
    ).rejects.toThrow('Invalid AI canary authorization request')

    const childReleaseSha = '8'.repeat(40)
    const childIssue = await runCanaryOperatorChild(
      [
        'issue',
        childReleaseSha,
        '--operator',
        'ai-operation-test-actor',
        '--reason',
        'canary-stdout-contract',
        '--ticket',
        'AI-CANARY-STDOUT-1',
        '--apply',
      ],
      'ai-operation-test-actor',
    )
    expect(childIssue.exitCode, childIssue.stderr).toBe(0)
    const childClaim: unknown = JSON.parse(childIssue.stdout)
    expect(childIssue.stdout).toBe(`${JSON.stringify(childClaim)}\n`)
    expect(childClaim).toMatchObject({
      releaseSha: childReleaseSha,
      attemptNumber: 1,
    })
    const deniedChild = await runCanaryOperatorChild(
      [
        'issue',
        '7'.repeat(40),
        '--operator',
        'not-registered',
        '--reason',
        'canary-stdout-denial',
        '--ticket',
        'AI-CANARY-STDOUT-2',
        '--apply',
      ],
      'ai-operation-test-actor',
    )
    expect(deniedChild.exitCode).toBe(1)
    expect(deniedChild.stdout).toBe('')
    const [firstIssue, concurrentReplay] = await Promise.all([
      authorizations.issue(issueGenerationOne),
      authorizations.issue(issueGenerationOne),
    ])
    expect(firstIssue.status).toBe('issued')
    expect(concurrentReplay).toEqual(firstIssue)
    if (firstIssue.status !== 'issued') {
      throw new Error('canary authorization was not issued')
    }
    expect(firstIssue.claim).toMatchObject({
      attemptNumber: 1,
      releaseSha: lifecycleReleaseSha,
      binding: {
        stopFence,
      },
    })
    await expect(
      authorizations.issue({
        ...issueGenerationOne,
        expected: { headGeneration: 2, stopFence },
      }),
    ).resolves.toEqual({ status: 'denied' })
    await expect(
      authorizations.issue({
        ...issueGenerationOne,
        expected: {
          ...issueGenerationOne.expected,
          stopFence: {
            ...stopFence,
            providerGeneration: stopFence.providerGeneration + 1,
          },
        },
      }),
    ).resolves.toEqual({ status: 'denied' })

    const [issuedOperation] = await db
      .select()
      .from(aiOperations)
      .where(eq(aiOperations.id, firstIssue.claim.operationId))
    const [issuedAttempt] = await db
      .select()
      .from(aiOperationAttempts)
      .where(eq(aiOperationAttempts.operationId, firstIssue.claim.operationId))
    const [issuedPermit] = await db
      .select()
      .from(aiExecutionPermits)
      .where(eq(aiExecutionPermits.id, firstIssue.claim.permitId))
    const profileBytes = Buffer.from('synthetic-canary-v1', 'utf8')
    const profileLength = Buffer.alloc(2)
    profileLength.writeUInt16BE(profileBytes.byteLength)
    const generation = Buffer.alloc(4)
    generation.writeUInt32BE(1)
    const expectedIdempotencyKey = createHash('sha256')
      .update(Buffer.from('ai-canary-operation-v1\0', 'utf8'))
      .update(Buffer.from(lifecycleReleaseSha, 'hex'))
      .update(profileLength)
      .update(profileBytes)
      .update(generation)
      .digest('hex')
    expect(issuedOperation).toMatchObject({
      command: 'synthetic_canary',
      state: 'executing',
      executionAttempt: 1,
      canaryAuthorizationId: firstIssue.claim.binding.canaryAuthorizationId,
      idempotencyKey: expectedIdempotencyKey,
      requestFingerprint: expectedIdempotencyKey,
    })
    expect(issuedAttempt).toMatchObject({ attempt: 1, state: 'executing' })
    expect(issuedPermit).toMatchObject({
      operationId: firstIssue.claim.operationId,
      executionAttempt: 1,
      state: 'issued',
    })

    await expect(
      authorizations.revoke({
        authorizationId: firstIssue.claim.binding.canaryAuthorizationId,
        expectedHeadGeneration: 2,
      }),
    ).resolves.toEqual({ status: 'revoked' })
    await expect(
      authorizations.revoke({
        authorizationId: firstIssue.claim.binding.canaryAuthorizationId,
        expectedHeadGeneration: 2,
      }),
    ).resolves.toEqual({ status: 'revoked' })
    const [revokedOperation] = await db
      .select()
      .from(aiOperations)
      .where(eq(aiOperations.id, firstIssue.claim.operationId))
    const [revokedAttempt] = await db
      .select()
      .from(aiOperationAttempts)
      .where(eq(aiOperationAttempts.operationId, firstIssue.claim.operationId))
    const [revokedPermit] = await db
      .select()
      .from(aiExecutionPermits)
      .where(eq(aiExecutionPermits.id, firstIssue.claim.permitId))
    expect(revokedOperation).toMatchObject({
      state: 'cancelled',
      failureCode: 'canary_authorization_revoked',
    })
    expect(revokedAttempt).toMatchObject({
      state: 'cancelled',
      failureCode: 'canary_authorization_revoked',
    })
    expect(revokedPermit).toMatchObject({ state: 'released' })

    const generationTwo = await authorizations.issue({
      ...issueGenerationOne,
      expected: { headGeneration: 3, stopFence },
      nonce: 'd'.repeat(64),
    })
    if (generationTwo.status !== 'issued') {
      throw new Error('second canary generation was not issued')
    }
    expect(generationTwo.claim.binding.canaryAuthorizationGeneration).toBe(2)
    await executeWithLastOwnerGuardDisabled(db, [
      sql`ALTER TABLE ai_operations DISABLE TRIGGER USER`,
      sql`ALTER TABLE ai_execution_permits DISABLE TRIGGER USER`,
      sql`UPDATE ai_operations
          SET expires_at = transaction_timestamp()
          WHERE id = ${generationTwo.claim.operationId}::uuid`,
      sql`UPDATE ai_execution_permits
          SET expires_at = transaction_timestamp()
          WHERE id = ${generationTwo.claim.permitId}::uuid`,
      sql`ALTER TABLE ai_execution_permits ENABLE TRIGGER USER`,
      sql`ALTER TABLE ai_operations ENABLE TRIGGER USER`,
    ])
    await expect(
      authorizations.issue({
        ...issueGenerationOne,
        expected: { headGeneration: 3, stopFence },
        nonce: '0'.repeat(64),
      }),
    ).resolves.toEqual({ status: 'denied' })
    const [headAfterExpiredMismatch] = await db
      .select()
      .from(aiCanaryAuthorizationHeads)
      .where(eq(aiCanaryAuthorizationHeads.releaseSha, lifecycleReleaseSha))
    expect(headAfterExpiredMismatch).toMatchObject({
      transitionGeneration: 4,
      state: 'issued',
      currentAuthorizationId: generationTwo.claim.binding.canaryAuthorizationId,
    })
    await expect(
      authorizations.issue({
        ...issueGenerationOne,
        expected: { headGeneration: 3, stopFence },
        nonce: 'd'.repeat(64),
      }),
    ).resolves.toEqual({ status: 'denied' })
    const [headAfterClaimExpiry] = await db
      .select()
      .from(aiCanaryAuthorizationHeads)
      .where(eq(aiCanaryAuthorizationHeads.releaseSha, lifecycleReleaseSha))
    expect(headAfterClaimExpiry).toMatchObject({
      transitionGeneration: 5,
      state: 'eligible',
      currentAuthorizationId: null,
      currentOperationId: null,
      currentPermitId: null,
    })
    await expect(authorizations.reapExpired({ limit: 10 })).resolves.toEqual({
      reaped: 0,
    })
    const [expiredOperation] = await db
      .select()
      .from(aiOperations)
      .where(eq(aiOperations.id, generationTwo.claim.operationId))
    const [expiredAttempt] = await db
      .select()
      .from(aiOperationAttempts)
      .where(eq(aiOperationAttempts.operationId, generationTwo.claim.operationId))
    const [expiredPermit] = await db
      .select()
      .from(aiExecutionPermits)
      .where(eq(aiExecutionPermits.id, generationTwo.claim.permitId))
    expect(expiredOperation).toMatchObject({
      state: 'cancelled',
      failureCode: 'canary_authorization_expired',
    })
    expect(expiredAttempt).toMatchObject({
      state: 'cancelled',
      failureCode: 'canary_authorization_expired',
    })
    expect(expiredPermit).toMatchObject({ state: 'released' })

    const generationThree = await authorizations.issue({
      ...issueGenerationOne,
      expected: { headGeneration: 5, stopFence },
      nonce: 'e'.repeat(64),
    })
    if (generationThree.status !== 'issued') {
      throw new Error('third canary generation was not issued')
    }
    expect(generationThree.claim.binding.canaryAuthorizationGeneration).toBe(3)
    await executeWithLastOwnerGuardDisabled(db, [
      sql`ALTER TABLE ai_canary_authorizations DISABLE TRIGGER USER`,
      sql`UPDATE ai_canary_authorizations
          SET issued_at = transaction_timestamp() - interval '6 minutes',
              expires_at = transaction_timestamp() - interval '1 minute'
          WHERE id = ${generationThree.claim.binding.canaryAuthorizationId}::uuid`,
      sql`ALTER TABLE ai_canary_authorizations ENABLE TRIGGER USER`,
    ])
    await expect(authorizations.reapExpired({ limit: 10 })).resolves.toEqual({
      reaped: 1,
    })
    await expect(authorizations.reapExpired({ limit: 10 })).resolves.toEqual({
      reaped: 0,
    })
    await expect(
      authorizations.issue({
        ...issueGenerationOne,
        expected: { headGeneration: 7, stopFence },
        nonce: 'f'.repeat(64),
      }),
    ).resolves.toEqual({ status: 'denied' })
    const [exhaustedHead] = await db
      .select()
      .from(aiCanaryAuthorizationHeads)
      .where(eq(aiCanaryAuthorizationHeads.releaseSha, lifecycleReleaseSha))
    expect(exhaustedHead).toMatchObject({
      transitionGeneration: 7,
      nextAuthorizationGeneration: 4,
      currentAuthorizationId: null,
      currentOperationId: null,
      currentPermitId: null,
      state: 'eligible',
    })

    const releaseSha = 'e'.repeat(40)
    const authorization = await authorizations.issue({
      ...issueGenerationOne,
      releaseSha,
      expected: { headGeneration: 1, stopFence },
      nonce: 'a'.repeat(64),
    })
    if (authorization.status !== 'issued') {
      throw new Error('admission canary authorization was not issued')
    }
    const claim = authorization.claim
    const descriptor = {
      version: 'ai-admission-descriptor-v1' as const,
      subjectKind: 'synthetic_canary' as const,
      route: 'synthetic-canary' as const,
      operationId: claim.operationId,
      permitId: claim.permitId,
      attemptNumber: claim.attemptNumber,
      sourceDigest: '4'.repeat(64),
      preparedDigest: '5'.repeat(64),
      sourceByteCount: 0,
      preparedByteCount: 128,
      providerPayloadByteCount: 128,
      promptCacheShard: 0,
      limits: {
        sourceBytes: 1,
        providerPayloadBytes: 1_024,
        preparedRequestBytes: 1_024,
        responseBytes: 4_096,
        outputTokens: 100,
        costMicros: 100_000,
      },
      callerDeadlineEpochMillis: claim.deadlineEpochMillis,
      organizationId: null,
      propertyId: null,
      internalSubjectId: null,
      actorId: null,
      binding: null,
      canaryBinding: claim.binding,
      releaseSha,
      canaryAuthorizationId: claim.binding.canaryAuthorizationId,
      observedContentExpiresAtEpochMillis: null,
      redactionCountry: null,
      redactionProfileVersion: null,
      outputLeakageProfileVersion: null,
      outputLeakageProfileDigest: null,
      replyTemplateCatalogueVersion: null,
      replyTemplateCatalogueDigest: null,
    }
    const authority = createPostgresAiAdmissionAuthority({
      pool: getPool(),
      signingKid: 'grant-v1',
    })
    const admitted = await authority.authorizeCanary(descriptor, {
      keyId: 'binding-v1',
      hmac: 'C'.repeat(43),
    })
    if (admitted.status !== 'admitted') {
      throw new Error(`canary admission denied: ${admitted.code}`)
    }
    const settled = await authority.settle(
      {
        operationId: claim.operationId,
        permitId: claim.permitId,
        attemptNumber: claim.attemptNumber,
        nonce: admitted.nonce,
        disposition: 'success',
        reportedDisposition: 'success',
        providerRetryable: false,
        usageKnown: true,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        retryAfterSeconds: null,
      },
      'grant-v1',
    )
    expect(settled).toMatchObject({
      status: 'settled',
      settlementState: 'settled',
    })

    await expect(
      control.transition({
        scope: { kind: 'capability', capability: 'reply_drafting' },
        providerDeploymentProfileVersion: 'private-beta-global-v1',
        expectedControlId: replyFence.controlId,
        expectedGeneration: replyFence.generation,
        executionState: 'enabled',
        admissionState: 'accepting',
        reasonCode: 'canary_test_passed',
        actorUserId: 'ai-operation-test-actor',
        ticketReference: 'canary-test-activate-reply',
        candidateReleaseSha: releaseSha,
      }),
    ).resolves.toMatchObject({
      executionState: 'enabled',
      admissionState: 'accepting',
    })
  })
})
