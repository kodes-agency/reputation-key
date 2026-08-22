// Real-PostgreSQL proof for the operator review-analysis backfill.
//
// The unit tests pin the use case's ordering, refusals and dry-run silence
// against a fake session. What only a real database can prove is the part the
// design actually rests on: that `reposition_merchant_ai_analysis_watermark_v1`
// survives the append-only consent-ledger guards, and that
// `lock_review_ai_analysis_head_v1` really does hand back `H+1 … H+N` with the
// review pointers moved and one outbox row each.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq, sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import {
  merchantAiConsentEvidence,
  merchantAiEnablement,
  outboxEvents,
  properties,
  reviewAiAnalysisHeads,
  reviews,
  aiReviewAnalysisBackfillRuns,
} from '#/shared/db/schema'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import { executeWithLastOwnerGuardDisabled } from '#/shared/db/disable-guard-triggers'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'
import {
  createBackfillReviewAnalysis,
  type BackfillReviewAnalysisResult,
} from '../../application/use-cases/backfill-review-analysis'
import { createReviewAnalysisBackfillAdapter } from './ai-review-analysis-backfill.adapter'
import { createPropertyGrantHolderLookup } from '#/contexts/identity/infrastructure/adapters/grant-access-lookup.adapter'

const NOW = new Date('2026-08-22T09:00:00.000Z')
const CONTENT_EXPIRES_AT = new Date('2027-08-22T09:00:00.000Z')
const ORGANIZATION_ID = organizationId('ai-reanalyze-backfill-test-org')
const PROPERTY_ID = propertyId('7a000000-0000-4000-8000-000000000001')
const LINEAGE_ID = '7a000000-0000-4000-8000-000000000002'
const CONNECTION_ID = '7a000000-0000-4000-8000-000000000003'
const ACTOR_USER_ID = 'ai-reanalyze-test-actor'
const SOURCE_EPOCH = 3
const HEAD_SEQUENCE = 256
const DIGEST = 'a'.repeat(64)

const RUNTIME_PROFILES = {
  review_analysis: 'review-analysis-runtime-v1',
  reply_drafting: 'reply-drafting-runtime-v1',
} as const

/**
 * Stored sequences chosen to be exactly what the backfill must ignore: `0`
 * (a review that predates the allocator, which the allocator can never emit),
 * a duplicate, one far past the head, and one already equal to the head.
 */
const STORED_SEQUENCES = [0, 5, 5, 900, 256] as const

const REVIEW_IDS = STORED_SEQUENCES.map((_, index) =>
  reviewId(`7a000000-0000-4000-8000-1000000000${String(index).padStart(2, '0')}`),
)

describe('review analysis backfill adapter (real PostgreSQL)', () => {
  const db = getDb()
  const backfill = createBackfillReviewAnalysis({
    backfillStore: createReviewAnalysisBackfillAdapter(db),
    // The real identity-owned adapter: this is the sanctioned route to the
    // grant table, and wiring the real one keeps the seam honest here.
    propertyAccessHolders: createPropertyGrantHolderLookup(db),
  })

  const clear = async () => {
    await db
      .delete(outboxEvents)
      .where(eq(outboxEvents.organizationId, ORGANIZATION_ID as string))
    await db.delete(properties).where(eq(properties.id, PROPERTY_ID))
    await db.execute(
      sql`DELETE FROM google_connections WHERE organization_id = ${ORGANIZATION_ID}`,
    )
    // `guard_last_owner` refuses to remove the org's only owner, so teardown
    // suspends it the same way the other AI store tests do.
    await executeWithLastOwnerGuardDisabled(db, [
      sql`DELETE FROM member WHERE "organizationId" = ${ORGANIZATION_ID}`,
    ])
    await db.execute(sql`DELETE FROM "user" WHERE id = ${ACTOR_USER_ID}`)
    await db.execute(sql`DELETE FROM organization WHERE id = ${ORGANIZATION_ID}`)
  }

  const seed = async (
    overrides: Readonly<{
      propertySourceEpoch?: number
      authorizedSourceEpoch?: number
      state?: string
      capabilities?: ReadonlyArray<string>
      /**
       * `actor_user_id` on the consent-evidence rows the backfill carries
       * forward from. Defaults to the seeded owner; set it to something that is
       * not a `member."userId"` to reproduce the live ops:ai-reanalyze failure.
       */
      priorActorUserId?: string
    }> = {},
  ) => {
    const propertySourceEpoch = overrides.propertySourceEpoch ?? SOURCE_EPOCH
    const authorizedSourceEpoch = overrides.authorizedSourceEpoch ?? SOURCE_EPOCH
    const priorActorUserId = overrides.priorActorUserId ?? ACTOR_USER_ID
    await db.execute(sql`
      INSERT INTO organization (id, name, slug, "createdAt")
      VALUES (${ORGANIZATION_ID}, 'AI reanalyze backfill test', ${ORGANIZATION_ID}, ${NOW})
    `)
    await db.execute(sql`
      INSERT INTO "user" (id, name, email, "emailVerified")
      VALUES (${ACTOR_USER_ID}, 'Backfill owner', ${`${ACTOR_USER_ID}@example.test`}, true)
    `)
    await db.execute(sql`
      INSERT INTO member (id, "organizationId", "userId", role, "createdAt")
      VALUES (${`${ACTOR_USER_ID}-member`}, ${ORGANIZATION_ID}, ${ACTOR_USER_ID}, 'owner', ${NOW})
    `)
    // `properties_google_binding_tuple_valid` requires a connection plus account
    // and location ids whenever the binding is `active`, and the reposition
    // refuses a property whose Google source is not active.
    await db.execute(sql`
      INSERT INTO google_connections (
        id, organization_id, google_subject, encrypted_access_token,
        encrypted_refresh_token, token_expires_at, scopes, connected_by, status,
        credential_use_state
      ) VALUES (
        ${CONNECTION_ID}::uuid, ${ORGANIZATION_ID}, 'google-subject-ai-reanalyze',
        'encrypted-access', 'encrypted-refresh', ${NOW},
        ARRAY['https://www.googleapis.com/auth/business.manage']::text[],
        ${ACTOR_USER_ID}, 'active', 'active'
      )
    `)
    await db.insert(properties).values({
      id: PROPERTY_ID,
      googleConnectionId: CONNECTION_ID,
      gbpAccountId: '117637856120281336154',
      gbpLocationId: '15441257785345231365',
      organizationId: ORGANIZATION_ID,
      name: 'AI reanalyze backfill test property',
      slug: 'ai-reanalyze-backfill-test-property',
      timezone: 'America/New_York',
      countryCode: 'US',
      processingRegion: 'global',
      googleBindingState: 'active',
      sourceEpoch: propertySourceEpoch,
    })
    const headEpochs =
      propertySourceEpoch === authorizedSourceEpoch
        ? [propertySourceEpoch]
        : [propertySourceEpoch, authorizedSourceEpoch]
    for (const epoch of headEpochs) {
      await db.insert(reviewAiAnalysisHeads).values({
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        sourceEpoch: epoch,
        headSequence: epoch === propertySourceEpoch ? HEAD_SEQUENCE : 0,
        updatedAt: NOW,
      })
    }
    for (const [index, storedSequence] of STORED_SEQUENCES.entries()) {
      await db.insert(reviews).values({
        id: REVIEW_IDS[index]!,
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        platform: 'google',
        externalId: `ai-reanalyze-review-${index}`,
        externalLocationId: 'locations/ai-reanalyze',
        rating: 4,
        text: `Backfill candidate ${index}`,
        languageCode: 'en',
        // Ascending, so (reviewed_at, id) is a deterministic order that does
        // NOT coincide with the stored analysis sequences.
        reviewedAt: new Date(NOW.getTime() - (STORED_SEQUENCES.length - index) * 1_000),
        expiresAt: CONTENT_EXPIRES_AT,
        contentExpiresAt: CONTENT_EXPIRES_AT,
        sourceEpoch: propertySourceEpoch,
        sourceRevision: index + 1,
        analysisSequence: storedSequence,
        aiSourceByteLength: 32,
        aiSourceDigest: DIGEST,
      })
    }
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('repkey.merchant_ai_transition', '1', true)`)
      const capabilities = [
        ...(overrides.capabilities ?? ['review_analysis', 'reply_drafting']),
      ]
      // The capability set and the runtime-profile map are constrained to move
      // in lockstep (merchant_ai_*_runtime_map_valid).
      const runtimeProfiles = Object.fromEntries(
        capabilities.map((capability) => [
          capability,
          RUNTIME_PROFILES[capability as keyof typeof RUNTIME_PROFILES],
        ]),
      )
      const shared = {
        organizationId: ORGANIZATION_ID as string,
        propertyId: PROPERTY_ID as string,
        state: overrides.state ?? 'enabled',
        capabilities,
        capabilityRuntimeProfileVersions: runtimeProfiles,
        reviewAnalysisEpoch: 2,
        replyDraftingEpoch: 1,
        propertyTrendsEpoch: 1,
        authorizedSourceEpoch,
        analysisStartSequence: 40,
        noticeVersion: MERCHANT_AI_NOTICE_VERSION,
        noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
        sourcePolicyId: 'google-business-profile-source-policy-v1',
        routingPolicyVersion: 1,
        processingRegion: 'global',
        providerDeploymentProfileVersion: 'private-beta-global-v1',
        redactionProfileFamily: 'gbp-review-global-v1',
      }
      await tx.insert(merchantAiConsentEvidence).values({
        ...shared,
        authorizationLineageId: LINEAGE_ID,
        stateVersion: 1,
        transitionKind: 'enable',
        state: 'enabled',
        capabilities: ['review_analysis', 'reply_drafting'],
        capabilityRuntimeProfileVersions: RUNTIME_PROFILES,
        reviewAnalysisEpoch: 1,
        actorUserId: priorActorUserId,
        reasonCode: 'merchant_enabled',
        idempotencyKey: 'ai-reanalyze-enable-v1',
        requestHash: '2'.repeat(64),
        occurredAt: NOW,
      })
      await tx.insert(merchantAiConsentEvidence).values({
        ...shared,
        authorizationLineageId: LINEAGE_ID,
        stateVersion: 2,
        transitionKind: capabilities.length === 0 ? 'revoke' : 'change',
        actorUserId: priorActorUserId,
        reasonCode: 'merchant_changed',
        idempotencyKey: 'ai-reanalyze-change-v1',
        requestHash: '3'.repeat(64),
        occurredAt: NOW,
      })
      await tx.insert(merchantAiEnablement).values({
        ...shared,
        authorizationLineageId: LINEAGE_ID,
        stateVersion: 2,
        updatedBy: priorActorUserId,
        updatedAt: NOW,
      })
    })
  }

  const run = (
    overrides: Readonly<{ dryRun?: boolean; limit?: number }> = {},
  ): Promise<BackfillReviewAnalysisResult> =>
    backfill({
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      limit: overrides.limit ?? 100,
      dryRun: overrides.dryRun ?? false,
      reasonCode: 'operator_review_analysis_backfill',
      idempotencyKey: 'ops-ai-reanalyze:integration',
      requestHash: 'b'.repeat(64),
      correlationId: '7a000000-0000-4000-8000-000000000099',
      occurredAt: NOW,
    })

  const emittedSequences = async (): Promise<ReadonlyArray<number>> => {
    const rows = await db
      .select({ payload: outboxEvents.payload })
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.organizationId, ORGANIZATION_ID as string),
          eq(outboxEvents.eventType, 'ai.review_analysis.backfill_requested'),
        ),
      )
    return rows
      .map(({ payload }) => {
        if (
          payload === null ||
          typeof payload !== 'object' ||
          !('analysisSequence' in payload) ||
          typeof payload.analysisSequence !== 'number'
        ) {
          throw new Error('backfill outbox payload lost its analysisSequence')
        }
        return payload.analysisSequence
      })
      .sort((a, b) => a - b)
  }

  beforeAll(clear)
  beforeEach(clear)
  afterAll(clear)

  it('opens a run pinning every candidate and emits only H+1', async () => {
    await seed()

    const result = await run()

    expect(result.status).toBe('applied')
    if (result.status !== 'applied') return
    // ONE event, whatever the stored sequences are. Allocating H+1..H+N up
    // front would move the head to H+N before the first event is consumed, and
    // `storeAnalysis` refuses every sequence but the head — so H+1..H+N-1 could
    // never be stored. The rest are allocated as each predecessor settles.
    expect(result.firstAnalysisSequence).toBe(257)
    expect(result.pinnedReviewCount).toBe(5)
    expect(await emittedSequences()).toEqual([257])

    const [head] = await db
      .select({ headSequence: reviewAiAnalysisHeads.headSequence })
      .from(reviewAiAnalysisHeads)
      .where(
        and(
          eq(reviewAiAnalysisHeads.propertyId, PROPERTY_ID),
          eq(reviewAiAnalysisHeads.sourceEpoch, SOURCE_EPOCH),
        ),
      )
    // The head moves by exactly one, so it still equals the in-flight sequence.
    expect(head?.headSequence).toBe(257)

    const [runRow] = await db
      .select()
      .from(aiReviewAnalysisBackfillRuns)
      .where(eq(aiReviewAnalysisBackfillRuns.propertyId, PROPERTY_ID))
    expect(runRow).toMatchObject({
      state: 'running',
      requestedReviewCount: 5,
      emittedReviewCount: 1,
      skippedReviewCount: 0,
      recoveredReviewCount: 0,
      currentAnalysisSequence: 257,
      analysisStartSequence: HEAD_SEQUENCE,
      reviewAnalysisEpoch: 3,
    })
    // Deterministic (reviewed_at, id) order, pinned once and never recomputed.
    expect(runRow?.reviewIds).toEqual([...REVIEW_IDS])
  })

  it('refuses a second run while one is still open', async () => {
    await seed()
    const first = await run()
    expect(first.status).toBe('applied')

    const second = await run()

    expect(second).toMatchObject({
      status: 'refused',
      refusal: 'backfill_already_running',
    })
    // Nothing written: still one emitted event and one epoch bump.
    expect(await emittedSequences()).toEqual([257])
  })

  it('repositions the watermark to the head and bumps only the analysis epoch', async () => {
    await seed()

    await run()

    const [enablement] = await db
      .select()
      .from(merchantAiEnablement)
      .where(eq(merchantAiEnablement.propertyId, PROPERTY_ID))
    expect(enablement).toMatchObject({
      // Repositioned to the head OBSERVED BEFORE the run, so the new cursor is
      // created at 256 and expects 257 next — exactly what was emitted.
      analysisStartSequence: HEAD_SEQUENCE,
      reviewAnalysisEpoch: 3,
      replyDraftingEpoch: 1,
      propertyTrendsEpoch: 1,
      authorizedSourceEpoch: SOURCE_EPOCH,
      state: 'enabled',
      stateVersion: 3,
    })

    const [evidence] = await db
      .select()
      .from(merchantAiConsentEvidence)
      .where(
        and(
          eq(merchantAiConsentEvidence.authorizationLineageId, LINEAGE_ID),
          eq(merchantAiConsentEvidence.stateVersion, 3),
        ),
      )
    // Recorded under its own kind, never disguised as a merchant 'change'.
    expect(evidence).toMatchObject({
      transitionKind: 'analysis_backfill',
      // The MEMBER who consented, carried forward from state_version 2 — not the
      // operator who ran the replay. `admit_ai_property_v1` resolves this column
      // as a `member."userId"` for every system-run operation, so an operator
      // identity here denies every backfilled review `authorization_changed`.
      actorUserId: ACTOR_USER_ID,
      reasonCode: 'operator_review_analysis_backfill',
      analysisStartSequence: HEAD_SEQUENCE,
      reviewAnalysisEpoch: 3,
      capabilities: ['review_analysis', 'reply_drafting'],
    })

    // The property that was missing: the recorded actor is a real member of
    // this organization. Asserting the string alone is what let the operator
    // email ship green.
    const priorEvidence = await db
      .select({ actorUserId: merchantAiConsentEvidence.actorUserId })
      .from(merchantAiConsentEvidence)
      .where(
        and(
          eq(merchantAiConsentEvidence.authorizationLineageId, LINEAGE_ID),
          eq(merchantAiConsentEvidence.stateVersion, 2),
        ),
      )
    expect(evidence?.actorUserId).toBe(priorEvidence[0]?.actorUserId)
    const members = await db.execute<{ role: string }>(sql`
      SELECT role FROM member
      WHERE "organizationId" = ${ORGANIZATION_ID}
        AND "userId" = ${evidence?.actorUserId}
    `)
    expect(members.rows).toEqual([{ role: 'owner' }])

    // The enablement's updated_by follows the same actor, so the head and the
    // ledger cannot disagree about who is accountable.
    expect(enablement).toMatchObject({ updatedBy: ACTOR_USER_ID })
  })

  it('moves the emitted review analysis pointer and touches no other column', async () => {
    await seed()
    const before = await db
      .select()
      .from(reviews)
      .where(eq(reviews.propertyId, PROPERTY_ID))
    const byId: Record<string, (typeof before)[number]> = Object.fromEntries(
      before.map((row) => [row.id, row]),
    )

    await run()

    const after = await db
      .select()
      .from(reviews)
      .where(eq(reviews.propertyId, PROPERTY_ID))
    for (const row of after) {
      const previous = byId[row.id]!
      // `analysis_sequence` is the only column the backfill may write.
      expect({ ...row, analysisSequence: previous.analysisSequence }).toEqual(previous)
    }
    // Only the review the run actually emitted is repointed. The other four keep
    // their stored sequences until their turn comes — repointing ahead would
    // move the allocation head past them and make their analyses unstorable.
    expect(after.map((row) => row.analysisSequence).sort((a, b) => a - b)).toEqual(
      [...STORED_SEQUENCES.slice(1), 257].sort((x, y) => x - y),
    )
  })

  it('writes nothing on a dry run', async () => {
    await seed()

    const result = await run({ dryRun: true })

    expect(result.status).toBe('planned')
    if (result.status !== 'planned') return
    expect(result.plan).toMatchObject({
      headSequence: HEAD_SEQUENCE,
      eligibleReviewCount: 5,
      selectedReviewCount: 5,
      firstAnalysisSequence: 257,
      lastAnalysisSequence: 261,
      nextReviewAnalysisEpoch: 3,
      nextAnalysisStartSequence: HEAD_SEQUENCE,
    })
    expect(await emittedSequences()).toEqual([])
    const [head] = await db
      .select({ headSequence: reviewAiAnalysisHeads.headSequence })
      .from(reviewAiAnalysisHeads)
      .where(
        and(
          eq(reviewAiAnalysisHeads.propertyId, PROPERTY_ID),
          eq(reviewAiAnalysisHeads.sourceEpoch, SOURCE_EPOCH),
        ),
      )
    expect(head?.headSequence).toBe(HEAD_SEQUENCE)
    const [enablement] = await db
      .select()
      .from(merchantAiEnablement)
      .where(eq(merchantAiEnablement.propertyId, PROPERTY_ID))
    expect(enablement).toMatchObject({
      analysisStartSequence: 40,
      reviewAnalysisEpoch: 2,
      stateVersion: 2,
    })
  })

  it('refuses a stale authorized source epoch, naming both numbers, and writes nothing', async () => {
    // The live shape of the Urban Move failure: the UI reads `enabled` while
    // every review would `policy_disabled` forever.
    await seed({ propertySourceEpoch: 1, authorizedSourceEpoch: 0 })

    const result = await run()

    expect(result.status).toBe('refused')
    if (result.status !== 'refused') return
    expect(result.refusal).toBe('authorized_source_epoch_stale')
    expect(result.message).toContain(
      'authorized_source_epoch 0 does not equal properties.source_epoch 1',
    )
    expect(await emittedSequences()).toEqual([])
    const [enablement] = await db
      .select()
      .from(merchantAiEnablement)
      .where(eq(merchantAiEnablement.propertyId, PROPERTY_ID))
    expect(enablement).toMatchObject({ reviewAnalysisEpoch: 2, stateVersion: 2 })
  })

  it('refuses when review_analysis was never authorized, and writes nothing', async () => {
    await seed({ capabilities: ['reply_drafting'] })

    const result = await run()

    expect(result.status).toBe('refused')
    if (result.status !== 'refused') return
    expect(result.refusal).toBe('review_analysis_not_authorized')
    expect(await emittedSequences()).toEqual([])
  })

  it('refuses to enable anything: the SQL rejects a reposition on a revoked head', async () => {
    await seed({ state: 'revoked', capabilities: [] })

    // Bypasses the use case's own refusal to prove the database is the second
    // line of defence, not the only one or the first.
    const raised = await db
      .execute(
        sql`
        SELECT *
        FROM reposition_merchant_ai_analysis_watermark_v1(
          ${ORGANIZATION_ID}, ${PROPERTY_ID}::uuid,
          'operator_review_analysis_backfill', 'ops-direct-1', ${'c'.repeat(64)},
          ${NOW.toISOString()}::timestamptz
        )
      `,
      )
      .then(
        () => null,
        (error: unknown) => error,
      )
    expect(raised).not.toBeNull()
    // Drizzle wraps the driver error; the refusal travels on the cause.
    const cause = raised instanceof Error ? raised.cause : null
    expect(cause instanceof Error ? cause.message : String(cause)).toContain(
      'merchant_ai_review_analysis_not_authorized',
    )
  })

  it('caps a piloted run at the limit and pins only that prefix', async () => {
    await seed()

    const result = await run({ limit: 2 })

    expect(result.status).toBe('applied')
    if (result.status !== 'applied') return
    expect(result.plan.capped).toBe(true)
    expect(result.pinnedReviewCount).toBe(2)
    expect(result.firstAnalysisSequence).toBe(257)
    expect(await emittedSequences()).toEqual([257])
  })

  it('refuses before writing when the member who consented is not a member', async () => {
    // The live ops:ai-reanalyze failure, exactly: the consent ledger's
    // actor_user_id holds an operator email, which `admit_ai_property_v1`
    // resolves as a `member."userId"` and can never find.
    await seed({ priorActorUserId: 'denev@kodes.agency' })

    const result = await run()

    expect(result.status).toBe('refused')
    if (result.status !== 'refused') return
    expect(result.refusal).toBe('consent_actor_unauthorized')
    // Lineage, state version and the actor it tried — everything an operator
    // needs to act, without reading the admission SQL.
    expect(result.message).toContain("consent-evidence actor 'denev@kodes.agency'")
    expect(result.message).toContain(`authorization lineage ${LINEAGE_ID}`)
    expect(result.message).toContain('at state_version 2')

    // Nothing written: no epoch burnt, no sequence allocated, no event emitted.
    expect(await emittedSequences()).toEqual([])
    const [enablement] = await db
      .select()
      .from(merchantAiEnablement)
      .where(eq(merchantAiEnablement.propertyId, PROPERTY_ID))
    expect(enablement).toMatchObject({
      reviewAnalysisEpoch: 2,
      stateVersion: 2,
      analysisStartSequence: 40,
    })
    const [head] = await db
      .select({ headSequence: reviewAiAnalysisHeads.headSequence })
      .from(reviewAiAnalysisHeads)
      .where(
        and(
          eq(reviewAiAnalysisHeads.propertyId, PROPERTY_ID),
          eq(reviewAiAnalysisHeads.sourceEpoch, SOURCE_EPOCH),
        ),
      )
    expect(head?.headSequence).toBe(HEAD_SEQUENCE)
  })

  it('cannot be told who to record: the SQL derives the actor and refuses an unresolvable one', async () => {
    await seed({ priorActorUserId: 'denev@kodes.agency' })

    // Bypasses the use case's refusal. The function takes no actor parameter at
    // all, so an operator identity is unrepresentable rather than merely
    // discouraged — and it still refuses the unresolvable carried-forward one.
    const raised = await db
      .execute(
        sql`
        SELECT *
        FROM reposition_merchant_ai_analysis_watermark_v1(
          ${ORGANIZATION_ID}, ${PROPERTY_ID}::uuid,
          'operator_review_analysis_backfill', 'ops-direct-actor-1', ${'d'.repeat(64)},
          ${NOW.toISOString()}::timestamptz
        )
      `,
      )
      .then(
        () => null,
        (error: unknown) => error,
      )
    expect(raised).not.toBeNull()
    const cause = raised instanceof Error ? raised.cause : null
    expect(cause instanceof Error ? cause.message : String(cause)).toContain(
      'merchant_ai_backfill_consent_actor_denied',
    )
  })

  it('the SQL skips an analysis_backfill head and carries the last consent decision forward', async () => {
    // The authoritative half of the selection rule, proven WITHOUT the use
    // case: the pre-flight read cannot be credited for this result.
    //
    // A prior backfill's row is forged at the head carrying an operator email —
    // the live closed-beta shape, and unfixable there because the ledger is
    // append-only. An `analysis_backfill` row is not a consent decision, so the
    // function must look past it to the merchant `change` at state_version 2 and
    // carry THAT member forward, which is what makes the lineage self-heal.
    await seed()
    const [head] = await db
      .select()
      .from(merchantAiEnablement)
      .where(eq(merchantAiEnablement.propertyId, PROPERTY_ID))
    if (!head) throw new Error('enablement head missing')
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('repkey.merchant_ai_transition', '1', true)`)
      await tx.insert(merchantAiConsentEvidence).values({
        organizationId: ORGANIZATION_ID as string,
        propertyId: PROPERTY_ID as string,
        authorizationLineageId: LINEAGE_ID,
        stateVersion: head.stateVersion + 1,
        transitionKind: 'analysis_backfill',
        state: head.state,
        capabilities: [...head.capabilities],
        capabilityRuntimeProfileVersions: head.capabilityRuntimeProfileVersions,
        reviewAnalysisEpoch: head.reviewAnalysisEpoch + 1,
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
        // Not a `member."userId"`, and now sitting at the head.
        actorUserId: 'denev@kodes.agency',
        reasonCode: 'operator_review_analysis_backfill',
        idempotencyKey: 'ai-reanalyze-broken-pilot-v3',
        requestHash: '4'.repeat(64),
        occurredAt: NOW,
      })
      await tx
        .update(merchantAiEnablement)
        .set({
          stateVersion: head.stateVersion + 1,
          reviewAnalysisEpoch: head.reviewAnalysisEpoch + 1,
          analysisStartSequence: HEAD_SEQUENCE,
          updatedBy: 'denev@kodes.agency',
          updatedAt: NOW,
        })
        .where(eq(merchantAiEnablement.propertyId, PROPERTY_ID))
    })

    const repositioned = await db.execute<{
      state_version: number
      consent_actor_user_id: string
    }>(sql`
      SELECT *
      FROM reposition_merchant_ai_analysis_watermark_v1(
        ${ORGANIZATION_ID}, ${PROPERTY_ID}::uuid,
        'operator_review_analysis_backfill', 'ops-direct-lineage-1', ${'e'.repeat(64)},
        ${NOW.toISOString()}::timestamptz
      )
    `)

    expect(repositioned.rows[0]).toMatchObject({
      state_version: 4,
      consent_actor_user_id: ACTOR_USER_ID,
    })
    // And the row it wrote — the one `admit_ai_property_v1` will read at the new
    // head — names that member, so the next admission resolves.
    const [written] = await db
      .select()
      .from(merchantAiConsentEvidence)
      .where(
        and(
          eq(merchantAiConsentEvidence.authorizationLineageId, LINEAGE_ID),
          eq(merchantAiConsentEvidence.stateVersion, 4),
        ),
      )
    expect(written).toMatchObject({
      transitionKind: 'analysis_backfill',
      actorUserId: ACTOR_USER_ID,
    })
  })
})
