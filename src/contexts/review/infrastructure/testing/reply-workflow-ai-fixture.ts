// Test-only: everything an AI-assisted reply is bound to, for the reply
// workflow harness.
//
// A manager adopts an AI suggestion through the real acceptance store
// (ai-suggested-draft-store.ts), so the reply carries real provenance and the
// real binding (ai-draft-binding.ts) decides whether it is current. This file
// seeds what that binding reads: the Property's AI processing profile, its
// Merchant AI authorization, one succeeded reply operation per suggestion, and
// the reply-drafting execution control.
//
// The binding and the acceptance store read PostgreSQL's clock, not the
// harness's, so this fixture stamps its rows from PostgreSQL too. A test
// cannot wait ten minutes for the adoption window to pass; `letWindowPass`
// moves the stored expiry into the past instead. The reply trigger counts that as a change of the reply (its
// state revision advances), which no real passage of time does; nothing here
// depends on the revision staying still across that step.

import { generateKeyPairSync } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import {
  aiExecutionControlHeads,
  aiExecutionControlTransitions,
  aiOperations,
  aiOrganizationCostWindows,
  aiPropertyProcessingProfiles,
  merchantAiConsentEvidence,
  merchantAiEnablement,
  properties,
  replies,
  reviewAiAnalysisHeads,
  reviews,
} from '#/shared/db/schema'
import type { OrganizationId, PropertyId, ReviewId, UserId } from '#/shared/domain/ids'
import type { Reply } from '../../domain/types'
import { digestRenderedReply, signAiReplyProvenance } from '#/shared/ai-reply-provenance'
import { AI_REPLY_TEMPLATE_CATALOGUE_DIGEST } from '#/shared/ai-reply-template-catalogue'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'
import { createAiSuggestedDraftStore } from '../ai-suggested-draft-store'

const KEY_ID = 'reply-workflow-provenance'
const LINEAGE_ID = '4f000000-0000-4000-8000-000000000041'
const COST_WINDOW_ID = '4f000000-0000-4000-8000-000000000042'
const DEPLOYMENT_PROFILE = 'private-beta-global-v1'
const RUNTIME_PROFILES = { reply_drafting: 'reply-drafting-runtime-v1' } as const
const SOURCE_POLICY = 'google-business-profile-source-policy-v1'
const REDACTION_PROFILE = 'gbp-review-global-v1'
const LEAKAGE_PROFILE = { version: 'ai-output-leakage-v1', digest: 'a'.repeat(64) }
const TEMPLATE_CATALOGUE_VERSION = 'gbp-reply-template-catalogue-v1'
const REQUEST_BINDING_HMAC = 'A'.repeat(43)
const REPLY_CONTROL_SCOPE = 'capability:reply_drafting'
const CONTROL_SCOPES = ['global', `provider:${DEPLOYMENT_PROFILE}`, REPLY_CONTROL_SCOPE]
const MINUTE_MS = 60_000
/** Long before any clock these tests run on. */
const WINDOW_PASSED = new Date('2000-01-01T00:00:00.000Z')

type ControlState = Readonly<{
  executionState: string
  admissionState: string
}>

export type ReplyWorkflowAiFixture = ReturnType<typeof createReplyWorkflowAiFixture>

export function createReplyWorkflowAiFixture(
  input: Readonly<{
    organizationId: OrganizationId
    propertyId: PropertyId
    reviewId: ReviewId
    actorUserId: UserId
  }>,
) {
  const { organizationId, propertyId, reviewId, actorUserId } = input
  const db = getDb()
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const store = createAiSuggestedDraftStore(db, new Map([[KEY_ID, publicKey]]), {
    isCurrentAiReplyBrandProfile: async () => true,
  })
  let operationSequence = 0
  let replyControlBefore: ControlState | null = null

  async function databaseNow(): Promise<Date> {
    const result = await db.execute<{ now: Date | string }>(sql`SELECT now() AS "now"`)
    const now = result.rows[0]?.now
    if (now === undefined) throw new Error('PostgreSQL returned no clock reading')
    return new Date(now)
  }

  const operationUuid = (kind: 2 | 3, sequence: number): string =>
    `4f000000-0000-4000-8000-${kind}${String(sequence).padStart(11, '0')}`

  async function controlHead(scopeKey: string) {
    const [head] = await db
      .select()
      .from(aiExecutionControlHeads)
      .where(eq(aiExecutionControlHeads.scopeKey, scopeKey))
      .limit(1)
    if (!head) throw new Error(`AI execution control ${scopeKey} is not seeded`)
    return head
  }

  /** The control is one row for the whole database; integration files run one
   * at a time, and `restore` puts back what `seed` found. */
  async function setReplyControl(state: ControlState): Promise<void> {
    const head = await controlHead(REPLY_CONTROL_SCOPE)
    if (
      head.executionState === state.executionState &&
      head.admissionState === state.admissionState
    ) {
      return
    }
    const occurredAt = await databaseNow()
    const generation = head.generation + 1
    await db.transaction(async (tx) => {
      await tx.insert(aiExecutionControlTransitions).values({
        controlId: head.controlId,
        generation,
        predecessorGeneration: head.generation,
        scopeKey: head.scopeKey,
        scopeKind: head.scopeKind,
        scopeValue: head.scopeValue,
        ...state,
        reasonCode: 'integration_test_transition',
        actorUserId,
        ticketReference: `reply-workflow-model-${generation}`,
        candidateReleaseSha: null,
        occurredAt,
      })
      await tx
        .update(aiExecutionControlHeads)
        .set({ generation, ...state, updatedAt: occurredAt })
        .where(
          and(
            eq(aiExecutionControlHeads.scopeKey, REPLY_CONTROL_SCOPE),
            eq(aiExecutionControlHeads.generation, head.generation),
          ),
        )
    })
  }

  async function propertySourceEpoch(): Promise<number> {
    const [property] = await db
      .select({ sourceEpoch: properties.sourceEpoch })
      .from(properties)
      .where(
        and(eq(properties.id, propertyId), eq(properties.organizationId, organizationId)),
      )
      .limit(1)
    if (!property) throw new Error('The workflow property is missing')
    return property.sourceEpoch
  }

  /** Seed once per suite, after the Property and its Review exist. */
  async function seed(): Promise<void> {
    const head = await controlHead(REPLY_CONTROL_SCOPE)
    replyControlBefore = {
      executionState: head.executionState,
      admissionState: head.admissionState,
    }
    await setReplyControl({ executionState: 'enabled', admissionState: 'accepting' })

    const now = await databaseNow()
    const sourceEpoch = await propertySourceEpoch()
    await db
      .insert(reviewAiAnalysisHeads)
      .values({ organizationId, propertyId, sourceEpoch, createdAt: now, updatedAt: now })
      .onConflictDoNothing()
    const [analysisHead] = await db
      .select({ headSequence: reviewAiAnalysisHeads.headSequence })
      .from(reviewAiAnalysisHeads)
      .where(
        and(
          eq(reviewAiAnalysisHeads.organizationId, organizationId),
          eq(reviewAiAnalysisHeads.propertyId, propertyId),
          eq(reviewAiAnalysisHeads.sourceEpoch, sourceEpoch),
        ),
      )
      .limit(1)
    await db.insert(aiPropertyProcessingProfiles).values({
      propertyId,
      organizationId,
      countryCode: 'US',
      timezone: 'UTC',
      processingRegion: 'global',
      routingPolicyVersion: 1,
      providerDeploymentProfileVersion: DEPLOYMENT_PROFILE,
      sourceEpoch,
      profileVersion: 1,
      lifecycleState: 'active',
      updatedAt: now,
    })
    const authorization = {
      organizationId,
      propertyId,
      authorizationLineageId: LINEAGE_ID,
      stateVersion: 1,
      state: 'enabled',
      capabilities: ['reply_drafting'],
      capabilityRuntimeProfileVersions: RUNTIME_PROFILES,
      reviewAnalysisEpoch: 1,
      replyDraftingEpoch: 1,
      propertyTrendsEpoch: 1,
      authorizedSourceEpoch: sourceEpoch,
      analysisStartSequence: analysisHead?.headSequence ?? 0,
      noticeVersion: MERCHANT_AI_NOTICE_VERSION,
      noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
      sourcePolicyId: SOURCE_POLICY,
      routingPolicyVersion: 1,
      processingRegion: 'global',
      providerDeploymentProfileVersion: DEPLOYMENT_PROFILE,
      redactionProfileFamily: REDACTION_PROFILE,
    } as const
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('repkey.merchant_ai_transition', '1', true)`)
      await tx.insert(merchantAiConsentEvidence).values({
        ...authorization,
        capabilities: [...authorization.capabilities],
        transitionKind: 'enable',
        actorUserId,
        reasonCode: 'merchant_enabled',
        idempotencyKey: 'reply-workflow-model-enable-v1',
        requestHash: 'c'.repeat(64),
        occurredAt: now,
      })
      await tx.insert(merchantAiEnablement).values({
        ...authorization,
        capabilities: [...authorization.capabilities],
        updatedBy: actorUserId,
        updatedAt: now,
      })
    })
    await db
      .insert(aiOrganizationCostWindows)
      .values({
        id: COST_WINDOW_ID,
        organizationId,
        windowStart: sql`date_trunc('month', now())`,
        reservedMicros: 0,
        settledMicros: 42,
        capMicros: 50_000_000,
        updatedAt: sql`now()`,
      })
      .onConflictDoNothing()
  }

  /** Between tests, after the replies are gone: their operations go too. */
  async function reset(): Promise<void> {
    await db.delete(aiOperations).where(eq(aiOperations.organizationId, organizationId))
    operationSequence = 0
  }

  /** The Property's rows cascade with it; the shared control is put back. */
  async function restore(): Promise<void> {
    if (replyControlBefore) await setReplyControl(replyControlBefore)
    replyControlBefore = null
  }

  /**
   * One finished AI reply operation for `text`, and the signed token the
   * browser would hold for it. Saving a draft with that token is the adoption.
   */
  async function issueSuggestion(text: string): Promise<string> {
    const [review] = await db
      .select({
        sourceEpoch: reviews.sourceEpoch,
        sourceRevision: reviews.sourceRevision,
        replyStateRevision: reviews.replyStateRevision,
      })
      .from(reviews)
      .where(and(eq(reviews.id, reviewId), eq(reviews.organizationId, organizationId)))
      .limit(1)
    if (!review) throw new Error('The workflow review is missing')
    const [globalControl, providerControl, capabilityControl] = await Promise.all(
      CONTROL_SCOPES.map(controlHead),
    )
    operationSequence += 1
    const operationId = operationUuid(2, operationSequence)
    const now = await databaseNow()
    const fences = {
      sourceEpoch: review.sourceEpoch,
      sourceRevision: review.sourceRevision,
      baseReplyStateRevision: review.replyStateRevision,
      propertyProfileVersion: 1,
      providerDeploymentProfileVersion: DEPLOYMENT_PROFILE,
      operationProfileVersion: 'reply-suggestion-v1',
      outputLeakageProfileVersion: LEAKAGE_PROFILE.version,
      outputLeakageProfileDigest: LEAKAGE_PROFILE.digest,
      replyTemplateCatalogueVersion: TEMPLATE_CATALOGUE_VERSION,
      replyTemplateCatalogueDigest: AI_REPLY_TEMPLATE_CATALOGUE_DIGEST,
    } as const
    await db.insert(aiOperations).values({
      ...fences,
      id: operationId,
      idempotencyScope: `reply:${operationId}`,
      idempotencyKey: operationId,
      requestFingerprint: 'f'.repeat(64),
      sourceDigest: 'e'.repeat(64),
      sourceByteCount: 20,
      command: 'reply',
      capability: 'reply_drafting',
      organizationId,
      propertyId,
      actorUserId,
      systemPrincipal: null,
      reviewId,
      reviewedAtEpochMillis: now.getTime(),
      tone: 'professional',
      authorizationLineageId: LINEAGE_ID,
      noticeVersion: MERCHANT_AI_NOTICE_VERSION,
      noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
      routingPolicyVersion: 1,
      capabilityRuntimeProfileVersion: RUNTIME_PROFILES.reply_drafting,
      replyBrandProfileVersion: null,
      replyBrandDisplayNameDigest: null,
      sourcePolicyId: SOURCE_POLICY,
      redactionProfileVersion: REDACTION_PROFILE,
      concreteReplyLanguageTag: 'en-Latn-US',
      concreteReplyTemplateGroup: 'en-Latn',
      capabilityFences: {
        capability: 'reply_drafting',
        replyDraftingEpoch: 1,
        baseReplyStateRevision: review.replyStateRevision,
      },
      globalControlId: globalControl!.controlId,
      globalControlGeneration: globalControl!.generation,
      providerControlId: providerControl!.controlId,
      providerControlGeneration: providerControl!.generation,
      capabilityControlId: capabilityControl!.controlId,
      capabilityControlGeneration: capabilityControl!.generation,
      routeKey: 'reply-suggestion',
      executionPermitId: operationUuid(3, operationSequence),
      admissionNonce: `nonce-${operationId}`,
      requestBindingKeyId: 'binding-v1',
      requestBindingHmac: REQUEST_BINDING_HMAC,
      grantKid: 'grant-v1',
      costWindowId: COST_WINDOW_ID,
      reservedMicros: 50_000,
      actualMicros: 42,
      budgetReservedAt: new Date(now.getTime() - MINUTE_MS),
      budgetSettledAt: now,
      state: 'succeeded',
      executionAttempt: 1,
      createdAt: new Date(now.getTime() - MINUTE_MS),
      updatedAt: now,
      expiresAt: new Date(now.getTime() + 60 * MINUTE_MS),
      deliveredAt: now,
    })
    return signAiReplyProvenance(
      {
        ...fences,
        version: 'ai-reply-provenance-v1',
        kid: KEY_ID,
        operationId,
        actorId: actorUserId,
        organizationId,
        propertyId,
        reviewId,
        requestBindingHmac: REQUEST_BINDING_HMAC,
        replyDraftingEpoch: 1,
        modelSnapshot: 'gpt-5.4-mini-2026-03-17',
        promptVersion: 'reply-suggestion-prompt-v1',
        templateId: 'appreciation_positive',
        concreteLanguageTag: 'en-Latn-US',
        templateGroup: 'en-Latn',
        renderedSuggestionDigest: digestRenderedReply(text),
        tokenExpiresAtEpochMillis: now.getTime() + 5 * MINUTE_MS,
        draftExpiresAtEpochMillis: now.getTime() + 30 * MINUTE_MS,
      },
      privateKey,
    )
  }

  /** The ten-minute adoption window of every AI-assisted reply is over. */
  async function letWindowPass(): Promise<number> {
    const expired = await db
      .update(replies)
      .set({ aiDraftExpiresAt: WINDOW_PASSED })
      .where(
        and(
          eq(replies.organizationId, organizationId),
          eq(replies.authorship, 'ai_assisted'),
        ),
      )
      .returning({ id: replies.id })
    return expired.length
  }

  /** What the real binding says about the Review's reply right now. */
  function bindingOf(replyId: Reply['id']): Promise<'current' | 'not_ai' | 'stale'> {
    return store.assertCurrentBinding({ organizationId, replyId })
  }

  return { store, seed, reset, restore, issueSuggestion, letWindowPass, bindingOf }
}
