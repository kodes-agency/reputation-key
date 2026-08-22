// Real-PostgreSQL proof that a BACKFILLED operation is actually admitted.
//
// The backfill's own integration test proves the ledger row and the sequence
// run are written correctly. It cannot prove the thing the feature exists for:
// that the replayed reviews reach the provider. They did not. Every one of them
// was denied at `admit_ai_property_v1` and the suite stayed green, because no
// test drove admission after a backfill.
//
// The reason is one column. `merchant_ai_consent_evidence.actor_user_id` is
// resolved as a `member."userId"`: admission falls back to it for any operation
// whose own `actor_user_id` is NULL — which is EVERY system-run analysis — and
// denies `authorization_changed` unless it resolves to a member with authority
// over the property. The backfill wrote the ops operator's identity there, an
// operator is not a member, and because the backfill also bumps `state_version`
// its own row is the one the fallback lands on. The gateway then maps that
// denial to `capability_epoch_changed`, which is why the recorded symptom named
// the epoch while every epoch actually matched.
//
// So this file drives the real admission function end to end:
//   backfill -> claim the emitted analysis sequence -> authorizeProperty
// and asserts `admitted`. The companion test forges the pre-fix row (operator
// identity in the ledger) and pins the exact denial the closed-beta pilot hit,
// so a regression by any route fails here rather than in production.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { getPool } from '#/shared/db/pool'
import { executeWithLastOwnerGuardDisabled } from '#/shared/db/disable-guard-triggers'
import {
  aiExecutionControlHeads,
  aiPropertyProcessingProfiles,
  merchantAiConsentEvidence,
  merchantAiEnablement,
  outboxEvents,
  properties,
  reviewAiAnalysisHeads,
  reviews,
} from '#/shared/db/schema'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import { AI_OPERATION_PROFILES } from '#/shared/ai-operation-profiles'
import { maximumCostMicros } from '#/shared/ai-openai-provider-profile'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'
import { createAiOperationIdentity } from '../../domain/rules'
import type { AiExecutionBinding } from '../../domain/types'
import { createAiControlAdapter } from './ai-control.adapter'
import { createAiOperationStoreAdapter } from './ai-operation-store.adapter'
import { createPostgresAiAdmissionAuthority } from '../../../../../services/ai-execution-admission/postgres-admission-authority'
import { createBackfillReviewAnalysis } from '../../application/use-cases/backfill-review-analysis'
import { createReviewAnalysisBackfillAdapter } from './ai-review-analysis-backfill.adapter'
import { createPropertyGrantHolderLookup } from '#/contexts/identity/infrastructure/adapters/grant-access-lookup.adapter'

const NOW = new Date('2026-08-22T09:00:00.000Z')
const CONTENT_EXPIRES_AT = new Date(Date.now() + 365 * 86_400_000)
const ORGANIZATION_ID = organizationId('ai-reanalyze-admission-test-org')
const PROPERTY_ID = propertyId('7b000000-0000-4000-8000-000000000001')
const LINEAGE_ID = '7b000000-0000-4000-8000-000000000002'
const CONNECTION_ID = '7b000000-0000-4000-8000-000000000003'
const REVIEW_ID = reviewId('7b000000-0000-4000-8000-000000000004')
const ORIGIN_EVENT_ID = '7b000000-0000-4000-8000-000000000005'
const CANARY_AUTHORIZATION_ID = '7b000000-0000-4000-8000-000000000006'
const CANARY_OPERATION_ID = '7b000000-0000-4000-8000-000000000007'
const CANARY_HEAD_ID = '7b000000-0000-4000-8000-000000000008'
const RELEASE_SHA = '7'.repeat(40)
/** The member who consented. The backfill must carry exactly this forward. */
const CONSENT_ACTOR_ID = 'ai-reanalyze-admission-owner'
/** An ops operator identity — deliberately NOT a `member."userId"`. */
const OPERATOR_EMAIL = 'denev@kodes.agency'
const DIGEST = 'a'.repeat(64)
const SUBJECT_HMAC = 'b'.repeat(64)
const SOURCE_EPOCH = 3
const HEAD_SEQUENCE = 256
const SOURCE_BYTE_COUNT = 32

const RUNTIME_PROFILES = { review_analysis: 'review-analysis-runtime-v1' } as const

const REVIEW_OPERATION_PROFILE = AI_OPERATION_PROFILES.find(
  (profile) => profile.profileVersion === 'review-analysis-v1',
)
if (!REVIEW_OPERATION_PROFILE) {
  throw new Error('review-analysis-v1 operation profile is missing')
}
const PROVIDER_PAYLOAD_BYTE_COUNT = 256
// Derived from the compiled catalogue, never a duplicated formula: admission
// recomputes the ceiling from `ai_operation_profiles` and denies
// `source_mismatch` on any disagreement.
const ADMISSION_LIMITS = Object.freeze({
  sourceBytes: REVIEW_OPERATION_PROFILE.sourceByteLimit,
  providerPayloadBytes: REVIEW_OPERATION_PROFILE.providerPayloadByteLimit,
  preparedRequestBytes: REVIEW_OPERATION_PROFILE.preparedRequestByteLimit,
  responseBytes: REVIEW_OPERATION_PROFILE.responseByteLimit,
  outputTokens: REVIEW_OPERATION_PROFILE.maxOutputTokens,
  costMicros: maximumCostMicros(REVIEW_OPERATION_PROFILE, PROVIDER_PAYLOAD_BYTE_COUNT),
})

type Fence = Readonly<{ controlId: string; generation: number }>

describe('backfilled review analysis is admitted (real PostgreSQL)', () => {
  const db = getDb()
  const store = createAiOperationStoreAdapter(db)
  const backfill = createBackfillReviewAnalysis({
    backfillStore: createReviewAnalysisBackfillAdapter(db),
    propertyAccessHolders: createPropertyGrantHolderLookup(db),
  })
  let fences: Readonly<{ global: Fence; provider: Fence; capability: Fence }>

  const clear = async () => {
    await db
      .delete(outboxEvents)
      .where(eq(outboxEvents.organizationId, ORGANIZATION_ID as string))
    await executeWithLastOwnerGuardDisabled(db, [
      sql`DELETE FROM ai_operations WHERE organization_id = ${ORGANIZATION_ID}`,
      sql`DELETE FROM ai_admission_rate_windows WHERE scope_key IN (
        'global',
        'provider:private-beta-global-v1',
        ${`organization:${ORGANIZATION_ID}`},
        ${`property:${PROPERTY_ID}`}
      )`,
      sql`DELETE FROM properties WHERE id = ${PROPERTY_ID}::uuid`,
      sql`DELETE FROM google_connections WHERE organization_id = ${ORGANIZATION_ID}`,
      sql`DELETE FROM organization_capability WHERE organization_id = ${ORGANIZATION_ID}`,
      // `guard_last_owner` refuses to remove the org's only owner, so teardown
      // suspends it the same way the other AI store tests do.
      sql`DELETE FROM member WHERE "organizationId" = ${ORGANIZATION_ID}`,
      sql`DELETE FROM "user" WHERE id = ${CONSENT_ACTOR_ID}`,
      sql`DELETE FROM organization WHERE id = ${ORGANIZATION_ID}`,
    ])
  }

  /**
   * The release-canary rows that let `activateControls` flip
   * `capability:review_analysis` on. Separate from the org fixture: they are
   * seeded once and outlive the per-test reseed.
   */
  const clearCanary = async () => {
    await executeWithLastOwnerGuardDisabled(db, [
      sql`ALTER TABLE ai_canary_authorization_heads DISABLE TRIGGER USER`,
      sql`ALTER TABLE ai_canary_authorizations DISABLE TRIGGER USER`,
      sql`DELETE FROM ai_canary_authorization_heads WHERE release_sha = ${RELEASE_SHA}`,
      sql`DELETE FROM ai_operations WHERE release_sha = ${RELEASE_SHA}`,
      sql`DELETE FROM ai_canary_authorizations WHERE release_sha = ${RELEASE_SHA}`,
      sql`ALTER TABLE ai_canary_authorizations ENABLE TRIGGER USER`,
      sql`ALTER TABLE ai_canary_authorization_heads ENABLE TRIGGER USER`,
    ])
  }

  /** Everything `admit_ai_property_v1` reads, plus the backfill's own inputs. */
  const seed = async () => {
    await db.execute(sql`
      INSERT INTO organization (id, name, slug, "createdAt")
      VALUES (${ORGANIZATION_ID}, 'AI reanalyze admission test', ${ORGANIZATION_ID}, ${NOW})
    `)
    await db.execute(sql`
      INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
      VALUES (
        ${CONSENT_ACTOR_ID}, 'Backfill consent owner',
        ${`${CONSENT_ACTOR_ID}@example.test`}, true, ${NOW}, ${NOW}
      )
    `)
    await db.execute(sql`
      INSERT INTO member (id, "organizationId", "userId", role, "createdAt")
      VALUES (
        ${`${CONSENT_ACTOR_ID}-member`}, ${ORGANIZATION_ID},
        ${CONSENT_ACTOR_ID}, 'owner', ${NOW}
      )
    `)
    // `organization_capability` is keyed by PURPOSE (`ai.analyze`), which is
    // what provisionPropertyCapabilities writes — not by capability name.
    await db.execute(sql`
      INSERT INTO organization_capability (
        organization_id, capability, created_by, created_at
      ) VALUES (${ORGANIZATION_ID}, 'ai.analyze', ${CONSENT_ACTOR_ID}, ${NOW})
      ON CONFLICT DO NOTHING
    `)
    await db.execute(sql`
      INSERT INTO ai_provider_circuit_states (
        provider_deployment_profile_version, state, consecutive_failures,
        opened_until, updated_at
      ) VALUES ('private-beta-global-v1', 'closed', 0, NULL, ${NOW})
      ON CONFLICT (provider_deployment_profile_version)
      DO UPDATE SET state = 'closed', consecutive_failures = 0,
        opened_until = NULL, updated_at = EXCLUDED.updated_at
    `)
    // The reposition refuses a property whose Google source is not active, and
    // `properties_google_binding_tuple_valid` demands the connection plus ids.
    await db.execute(sql`
      INSERT INTO google_connections (
        id, organization_id, google_subject, encrypted_access_token,
        encrypted_refresh_token, token_expires_at, scopes, connected_by, status,
        credential_use_state
      ) VALUES (
        ${CONNECTION_ID}::uuid, ${ORGANIZATION_ID}, 'google-subject-ai-admission',
        'encrypted-access', 'encrypted-refresh', ${NOW},
        ARRAY['https://www.googleapis.com/auth/business.manage']::text[],
        ${CONSENT_ACTOR_ID}, 'active', 'active'
      )
    `)
    await db.insert(properties).values({
      id: PROPERTY_ID,
      googleConnectionId: CONNECTION_ID,
      gbpAccountId: '117637856120281336154',
      gbpLocationId: '15441257785345231366',
      organizationId: ORGANIZATION_ID,
      name: 'AI reanalyze admission test property',
      slug: 'ai-reanalyze-admission-test-property',
      timezone: 'America/New_York',
      countryCode: 'US',
      processingRegion: 'global',
      googleBindingState: 'active',
      sourceEpoch: SOURCE_EPOCH,
    })
    await db.insert(reviewAiAnalysisHeads).values({
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      sourceEpoch: SOURCE_EPOCH,
      headSequence: HEAD_SEQUENCE,
      updatedAt: NOW,
    })
    // A review the enablement's watermark already skipped — exactly what the
    // backfill exists to replay.
    await db.insert(reviews).values({
      id: REVIEW_ID,
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      platform: 'google',
      externalId: 'ai-reanalyze-admission-review',
      externalLocationId: 'locations/ai-reanalyze-admission',
      rating: 5,
      text: 'Excellent service, would come back',
      languageCode: 'en',
      reviewedAt: new Date(NOW.getTime() - 1_000),
      expiresAt: CONTENT_EXPIRES_AT,
      contentExpiresAt: CONTENT_EXPIRES_AT,
      sourceEpoch: SOURCE_EPOCH,
      sourceRevision: 5,
      analysisSequence: 0,
      aiSourceByteLength: SOURCE_BYTE_COUNT,
      aiSourceDigest: DIGEST,
    })
    await db.insert(aiPropertyProcessingProfiles).values({
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      countryCode: 'US',
      timezone: 'America/New_York',
      processingRegion: 'global',
      sourceEpoch: SOURCE_EPOCH,
      profileVersion: 3,
      providerDeploymentProfileVersion: 'private-beta-global-v1',
      routingPolicyVersion: 1,
      lifecycleState: 'active',
      updatedAt: NOW,
    })
    const shared = {
      organizationId: ORGANIZATION_ID as string,
      propertyId: PROPERTY_ID as string,
      state: 'enabled',
      capabilities: ['review_analysis'],
      capabilityRuntimeProfileVersions: RUNTIME_PROFILES,
      reviewAnalysisEpoch: 1,
      replyDraftingEpoch: 1,
      propertyTrendsEpoch: 1,
      authorizedSourceEpoch: SOURCE_EPOCH,
      // Below the head on purpose: the reviews above are the history the
      // watermark skipped.
      analysisStartSequence: 40,
      noticeVersion: MERCHANT_AI_NOTICE_VERSION,
      noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
      sourcePolicyId: 'google-business-profile-source-policy-v1',
      routingPolicyVersion: 1,
      processingRegion: 'global',
      providerDeploymentProfileVersion: 'private-beta-global-v1',
      redactionProfileFamily: 'gbp-review-global-v1',
    }
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('repkey.merchant_ai_transition', '1', true)`)
      await tx.insert(merchantAiConsentEvidence).values({
        ...shared,
        authorizationLineageId: LINEAGE_ID,
        stateVersion: 1,
        transitionKind: 'enable',
        // The merchant's own consent, taken by a real owner. This is the actor
        // the backfill must carry forward.
        actorUserId: CONSENT_ACTOR_ID,
        reasonCode: 'merchant_enabled',
        idempotencyKey: 'ai-reanalyze-admission-enable-v1',
        requestHash: '2'.repeat(64),
        occurredAt: NOW,
      })
      await tx.insert(merchantAiEnablement).values({
        ...shared,
        authorizationLineageId: LINEAGE_ID,
        stateVersion: 1,
        updatedBy: CONSENT_ACTOR_ID,
        updatedAt: NOW,
      })
    })
  }

  /**
   * `capability:review_analysis` ships killed/draining in the scratch database,
   * and admission denies a killed capability before it ever reaches the actor
   * check — so this activates it through the real CAS control adapter, which
   * requires a passed canary for the candidate release.
   */
  const activateControls = async () => {
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
        ]),
      )
    const global = rows.find((row) => row.scopeKey === 'global')
    const provider = rows.find(
      (row) => row.scopeKey === 'provider:private-beta-global-v1',
    )
    const capability = rows.find((row) => row.scopeKey === 'capability:review_analysis')
    if (!global || !provider || !capability) throw new Error('seeded AI controls missing')

    await db.execute(sql`
      INSERT INTO ai_canary_authorizations (
        id, release_sha, canary_profile_version, authorization_generation,
        predecessor_authorization_id, nonce, operator_user_id, state,
        issued_at, expires_at, settled_at
      ) VALUES (
        ${CANARY_AUTHORIZATION_ID}::uuid, ${RELEASE_SHA}, 'synthetic-canary-v1', 1,
        NULL, ${'b'.repeat(64)}, 'ai-reanalyze-admission-operator', 'passed',
        ${new Date(NOW.getTime() - 1_000)}, ${new Date(NOW.getTime() + 60_000)}, ${NOW}
      )
      ON CONFLICT (id) DO NOTHING
    `)
    await db.execute(sql`
      INSERT INTO ai_operations (
        id, idempotency_scope, idempotency_key, request_fingerprint,
        command, capability, system_principal, release_sha,
        canary_authorization_id, canary_authorization_generation,
        canary_profile_version, provider_deployment_profile_version,
        operation_profile_version, global_control_id, global_control_generation,
        provider_control_id, provider_control_generation, capability_control_id,
        capability_control_generation, capability_fences, state,
        execution_attempt, created_at, updated_at, expires_at
      ) VALUES (
        ${CANARY_OPERATION_ID}::uuid, 'release-canary:reanalyze-admission',
        'passed-canary', ${'c'.repeat(64)}, 'synthetic_canary', NULL,
        'release_canary', ${RELEASE_SHA}, ${CANARY_AUTHORIZATION_ID}::uuid, 1,
        'synthetic-canary-v1', 'private-beta-global-v1', 'synthetic-canary-v1',
        ${global.controlId}::uuid, ${global.generation},
        ${provider.controlId}::uuid, ${provider.generation}, NULL, NULL,
        jsonb_build_array(
          jsonb_build_object('capability', 'review_analysis'),
          jsonb_build_object('capability', 'reply_drafting'),
          jsonb_build_object('capability', 'property_trends')
        ),
        'succeeded', 1, ${new Date(NOW.getTime() - 1_000)}, ${NOW},
        ${new Date(NOW.getTime() + 60_000)}
      )
      ON CONFLICT (id) DO NOTHING
    `)
    await db.execute(sql`
      INSERT INTO ai_canary_authorization_heads (
        release_sha, canary_profile_version, head_id, transition_generation,
        next_authorization_generation, current_authorization_id,
        current_operation_id, current_permit_id, state, updated_at
      ) VALUES (
        ${RELEASE_SHA}, 'synthetic-canary-v1', ${CANARY_HEAD_ID}::uuid, 3, 2,
        ${CANARY_AUTHORIZATION_ID}::uuid, ${CANARY_OPERATION_ID}::uuid, NULL,
        'passed', ${NOW}
      )
      ON CONFLICT (release_sha, canary_profile_version) DO NOTHING
    `)

    const activated = await createAiControlAdapter(db).transition({
      scope: { kind: 'capability', capability: 'review_analysis' },
      providerDeploymentProfileVersion: 'private-beta-global-v1',
      expectedControlId: capability.controlId,
      expectedGeneration: capability.generation,
      executionState: 'enabled',
      admissionState: 'accepting',
      reasonCode: 'test_canary_passed',
      actorUserId: 'ai-reanalyze-admission-operator',
      ticketReference: 'test-activate-reanalyze-admission',
      candidateReleaseSha: RELEASE_SHA,
    })
    if (!activated) throw new Error('failed to activate review_analysis')
    fences = {
      global,
      provider,
      capability: { controlId: activated.controlId, generation: activated.generation },
    }
  }

  const bindingFor = (reviewAnalysisEpoch: number): AiExecutionBinding => ({
    authorizationLineageId: LINEAGE_ID,
    noticeVersion: MERCHANT_AI_NOTICE_VERSION,
    noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
    capabilityFence: { capability: 'review_analysis', reviewAnalysisEpoch },
    sourceEpoch: SOURCE_EPOCH,
    evaluatedLanguage: 'en',
    concreteReplyLanguage: null,
    languageCatalogueDigest: DIGEST,
    replyLanguageVerifierDigest: null,
    languageScriptConsistencyDigest: null,
    zhOrthographyVerifierDigest: null,
    sourceRevision: 5,
    reviewedAtEpochMillis: NOW.getTime() - 1_000,
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
  })

  /**
   * Claim and admit the replayed review exactly as `analyze-review-event` does:
   * a SYSTEM operation, so `ai_operations.actor_user_id` is NULL and admission
   * must fall back to the consent ledger for its accountable actor. That
   * fallback is the whole bug surface.
   */
  const admitBackfilledOperation = async (
    input: Readonly<{
      reviewAnalysisEpoch: number
      analysisSequence: number
      idempotencyKey: string
    }>,
  ) => {
    const identityResult = createAiOperationIdentity({
      command: 'analysis',
      organizationId: ORGANIZATION_ID as string,
      propertyId: PROPERTY_ID as string,
      actorId: null,
      systemPrincipal: 'review_event_consumer',
      reviewId: REVIEW_ID as string,
      originEventId: ORIGIN_EVENT_ID,
      subjectHmac: SUBJECT_HMAC,
      subjectHmacKeyVersion: 'ai-subject-hmac-v1',
      sourceEpoch: SOURCE_EPOCH,
      sourceRevision: 5,
      reviewedAtEpochMillis: NOW.getTime() - 1_000,
      analysisSequence: input.analysisSequence,
    })
    if (identityResult.isErr()) throw new Error(identityResult.error.message)

    const liveNow = Date.now()
    const binding = bindingFor(input.reviewAnalysisEpoch)
    const claimed = await store.claim({
      identity: identityResult.value,
      binding,
      idempotencyKey: input.idempotencyKey,
      requestFingerprint: 'f'.repeat(64),
      sourceProvenance: { digest: DIGEST, byteCount: SOURCE_BYTE_COUNT },
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

    // The operation carries no actor of its own — the precondition for the
    // consent-evidence fallback admission performs.
    const [operationRow] = await db
      .execute<{ actor_user_id: string | null }>(
        sql`
      SELECT actor_user_id FROM ai_operations WHERE id = ${executing.id}::uuid
    `,
      )
      .then((result) => result.rows)
    expect(operationRow?.actor_user_id).toBeNull()

    return createPostgresAiAdmissionAuthority({
      pool: getPool(),
      signingKid: 'grant-v1',
    }).authorizeProperty(
      {
        version: 'ai-admission-descriptor-v1' as const,
        subjectKind: 'property' as const,
        route: 'review-analysis' as const,
        operationId: executing.id,
        permitId: executing.executionPermitId,
        attemptNumber: 1,
        sourceDigest: DIGEST,
        preparedDigest: '2'.repeat(64),
        sourceByteCount: SOURCE_BYTE_COUNT,
        preparedByteCount: PROVIDER_PAYLOAD_BYTE_COUNT,
        providerPayloadByteCount: PROVIDER_PAYLOAD_BYTE_COUNT,
        promptCacheShard: 1,
        limits: ADMISSION_LIMITS,
        callerDeadlineEpochMillis:
          liveNow + REVIEW_OPERATION_PROFILE.requestDeadlineMs - 2_000,
        organizationId: ORGANIZATION_ID as string,
        propertyId: PROPERTY_ID as string,
        internalSubjectId: REVIEW_ID as string,
        actorId: null,
        binding,
        canaryBinding: null,
        releaseSha: null,
        canaryAuthorizationId: null,
        observedContentExpiresAtEpochMillis: CONTENT_EXPIRES_AT.getTime(),
        redactionCountry: 'US',
        redactionProfileVersion: binding.redactionProfileVersion,
        outputLeakageProfileVersion: null,
        outputLeakageProfileDigest: null,
        replyTemplateCatalogueVersion: null,
        replyTemplateCatalogueDigest: null,
      },
      { keyId: 'binding-v1', hmac: 'A'.repeat(43) },
    )
  }

  beforeAll(async () => {
    await clear()
    await clearCanary()
    // Control activation is global and needs no org fixture, so it happens once.
    await activateControls()
  })
  // Every test runs its OWN backfill against a virgin lineage: the reposition is
  // idempotency-keyed, so a second run on the same fixture would replay rather
  // than backfill.
  beforeEach(async () => {
    await clear()
    await seed()
  })
  afterAll(async () => {
    await clear()
    await clearCanary()
  })

  /** The backfill run every test in this file admits against. */
  const runBackfill = async () => {
    const applied = await backfill({
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      limit: 10,
      dryRun: false,
      reasonCode: 'operator_review_analysis_backfill',
      idempotencyKey: 'ops-ai-reanalyze:admission',
      requestHash: 'b'.repeat(64),
      correlationId: '7b000000-0000-4000-8000-000000000099',
      occurredAt: NOW,
    })
    if (applied.status !== 'applied') {
      throw new Error(`backfill did not apply: ${JSON.stringify(applied)}`)
    }
    return applied
  }

  it('admits a backfilled operation instead of denying it authorization_changed', async () => {
    const applied = await runBackfill()
    expect(applied.emittedAnalysisSequences).toEqual([HEAD_SEQUENCE + 1])

    // THE deliverable. Asserted before anything else so a regression fails on
    // the consequence — the replayed review never reaching the provider —
    // rather than on the ledger shape that merely causes it.
    const admitted = await admitBackfilledOperation({
      reviewAnalysisEpoch: applied.reviewAnalysisEpoch,
      analysisSequence: applied.emittedAnalysisSequences[0]!,
      idempotencyKey: 'backfilled-admission-key',
    })
    expect(admitted).toMatchObject({ status: 'admitted' })
  })

  it('records an accountable member on the evidence row admission reads', async () => {
    const applied = await runBackfill()
    // Carried forward from state_version 1, NOT the operator who ran this.
    expect(applied.consentActorUserId).toBe(CONSENT_ACTOR_ID)

    const [evidence] = await db
      .select()
      .from(merchantAiConsentEvidence)
      .where(
        and(
          eq(merchantAiConsentEvidence.authorizationLineageId, LINEAGE_ID),
          eq(merchantAiConsentEvidence.stateVersion, applied.stateVersion),
        ),
      )
    expect(evidence).toMatchObject({
      transitionKind: 'analysis_backfill',
      actorUserId: CONSENT_ACTOR_ID,
    })
    // The assertion whose absence let #341 ship: not just the string, but that
    // it RESOLVES — `actor_user_id` is a `member."userId"`.
    const members = await db.execute<{ role: string }>(sql`
      SELECT role FROM member
      WHERE "organizationId" = ${ORGANIZATION_ID} AND "userId" = ${evidence?.actorUserId}
    `)
    expect(members.rows).toEqual([{ role: 'owner' }])
  })

  it('denies authorization_changed when the ledger actor is an operator, not a member', async () => {
    // The negative control for the test above, and the pilot's failure exactly.
    //
    // A real backfill runs first, so the review pointer, the analysis head and
    // the emitted sequence are all correct — nothing upstream of the actor check
    // can explain a denial. Then ONE more `analysis_backfill` evidence row is
    // forged in the shape #341 wrote (the ops operator's email in a
    // `member."userId"` column) with the enablement head advanced onto it. Same
    // lineage, same source epoch, same profiles, same control fences: the actor
    // is the only difference, and admission refuses.
    //
    // This is the assertion whose absence let #341 ship green — the writer's
    // shape was tested, its consequence at admission was not.
    const applied = await runBackfill()
    const [head] = await db
      .select()
      .from(merchantAiEnablement)
      .where(eq(merchantAiEnablement.propertyId, PROPERTY_ID))
    if (!head) throw new Error('enablement head missing')
    const nextStateVersion = head.stateVersion + 1
    const nextEpoch = head.reviewAnalysisEpoch + 1
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('repkey.merchant_ai_transition', '1', true)`)
      await tx.insert(merchantAiConsentEvidence).values({
        organizationId: ORGANIZATION_ID as string,
        propertyId: PROPERTY_ID as string,
        authorizationLineageId: LINEAGE_ID,
        stateVersion: nextStateVersion,
        transitionKind: 'analysis_backfill',
        state: head.state,
        capabilities: [...head.capabilities],
        capabilityRuntimeProfileVersions: head.capabilityRuntimeProfileVersions,
        reviewAnalysisEpoch: nextEpoch,
        replyDraftingEpoch: head.replyDraftingEpoch,
        propertyTrendsEpoch: head.propertyTrendsEpoch,
        authorizedSourceEpoch: head.authorizedSourceEpoch,
        analysisStartSequence: HEAD_SEQUENCE,
        noticeVersion: head.noticeVersion,
        noticeDigest: head.noticeDigest,
        sourcePolicyId: head.sourcePolicyId,
        routingPolicyVersion: head.routingPolicyVersion,
        processingRegion: head.processingRegion,
        providerDeploymentProfileVersion: head.providerDeploymentProfileVersion,
        redactionProfileFamily: head.redactionProfileFamily,
        // The bug, verbatim: an operator email in a `member."userId"` column.
        actorUserId: OPERATOR_EMAIL,
        reasonCode: 'operator_review_analysis_backfill',
        idempotencyKey: 'ops-ai-reanalyze:prefix-shape',
        requestHash: 'c'.repeat(64),
        occurredAt: NOW,
      })
      await tx
        .update(merchantAiEnablement)
        .set({
          stateVersion: nextStateVersion,
          reviewAnalysisEpoch: nextEpoch,
          analysisStartSequence: HEAD_SEQUENCE,
          updatedBy: OPERATOR_EMAIL,
          updatedAt: NOW,
        })
        .where(eq(merchantAiEnablement.propertyId, PROPERTY_ID))
    })

    const denied = await admitBackfilledOperation({
      reviewAnalysisEpoch: nextEpoch,
      analysisSequence: applied.emittedAnalysisSequences[0]!,
      idempotencyKey: 'prefix-shape-admission-key',
    })

    // Named the epoch in production only because the gateway remaps this code.
    expect(denied).toEqual({ status: 'denied', code: 'authorization_changed' })
  })
})
