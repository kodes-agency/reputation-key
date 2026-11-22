// A real-PostgreSQL fixture for suites that adopt AI reply suggestions in many
// Properties and take each reply as far as a confirmed publication: a Property
// with a current processing profile and Merchant AI consent, a settled
// reply-drafting operation bound to the live controls, the signed provenance
// token, and the reply itself through the real draft store and command store.
//
// The stores and adapters come in from the suite, so each suite keeps its own
// wiring and this module stays free of context imports beyond types. Ids come
// from the suite's own UUID prefix, so fixed ids never collide between files.

import { createHash, type KeyObject } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  aiExecutionControlHeads,
  aiOperations,
  aiOrganizationCostWindows,
  merchantAiConsentEvidence,
  merchantAiEnablement,
  properties,
  reviewAiAnalysisHeads,
} from '#/shared/db/schema'
import {
  reviewId as toReviewId,
  propertyId as toPropertyId,
  type OrganizationId,
  type PropertyId,
  type ReviewId,
  type UserId,
} from '#/shared/domain/ids'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'
import { AI_REPLY_TEMPLATE_CATALOGUE_DIGEST } from '#/shared/reply/ai-reply-template-catalogue'
import {
  digestRenderedReply,
  signAiReplyProvenance,
} from '#/shared/reply/ai-reply-provenance'
import { GOOGLE_LOCATION_PRIMARY_RESOURCE } from '#/shared/testing/google-provider-identifiers-v1'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import type { createAiControlAdapter } from '#/contexts/ai/infrastructure/adapters/ai-control.adapter'
import type { createPropertyProcessingProfileAdapter } from '#/contexts/ai/analysis/property-processing-profile.adapter.server'
import type { Reply, Review } from '../domain/review-types'
import {
  reviewReplyApproved,
  reviewReplyPublicationRequested,
  reviewReplySubmitted,
  reviewUpdated,
} from '../domain/review-events'
import type { ReplyRepository } from './reply-repository.port.server'
import type { createAtomicReviewCommandStore } from '../reviews/review-command-store.server'
import type { AiSuggestedDraftStore } from './ai-suggested-draft-store.port.server'
import type { ReviewRepository } from '../reviews/review-repository.port.server'
import type { createAtomicReplyCommandStore } from './reply-command-store.server'

export const SOURCE_EPOCH = 2
export const PROVIDER_PROFILE = 'private-beta-global-v2'
export const SUGGESTION = 'Thank you for sharing your experience.'
export const MINUTE_MS = 60_000
export const DAY_MS = 24 * 60 * MINUTE_MS
const RELEASE_SHA = 'a'.repeat(40)

export type ReplyStage = 'draft' | 'pending_approval' | 'authorized'

export type SeededReply = Readonly<{
  property: PropertyId
  review: Omit<Review, 'createdAt' | 'updatedAt'>
  reply: Reply
  operationId: string
}>

/** What the purge leaves of a confirmed reply: an empty draft, no AI claim. */
export const WITHDRAWN = {
  status: 'draft',
  publication_state: 'cancelled',
  text: '',
  authorship: 'human',
  origin_operation_id: null,
  reconcile_due_at: null,
}

export type AiReplyAdoptionFixtureConfig = Readonly<{
  db: Database
  organizationId: OrganizationId
  submitter: UserId
  approver: UserId
  operator: string
  /** Names the rows this suite writes; also the observation-key namespace. */
  label: string
  /** Eight hex digits that start every UUID this suite generates. */
  idPrefix: string
  privateKey: KeyObject
  reviewRepository: Pick<ReviewRepository, 'upsert'>
  reviewCommandStore: Pick<
    ReturnType<typeof createAtomicReviewCommandStore>,
    'upsertAndRecord'
  >
  replyRepository: Pick<ReplyRepository, 'findById'>
  draftStore: Pick<AiSuggestedDraftStore, 'accept'>
  replyCommandStore: Pick<
    ReturnType<typeof createAtomicReplyCommandStore>,
    'submitReply' | 'markPublicationAuthorized'
  >
  profiles: Pick<
    ReturnType<typeof createPropertyProcessingProfileAdapter>,
    'refreshForAi'
  >
  control: Pick<ReturnType<typeof createAiControlAdapter>, 'transition'>
}>

export function createAiReplyAdoptionSeeder(config: AiReplyAdoptionFixtureConfig) {
  const {
    db,
    organizationId: ORG,
    submitter: SUBMITTER,
    approver: APPROVER,
    label,
    idPrefix,
  } = config

  let sequence = 0
  /** A UUID no other row in this suite uses; `kind` keeps the families apart. */
  const nextId = (kind: number): string => {
    sequence += 1
    return `${idPrefix}-0000-4000-8${String(kind).padStart(3, '0')}-${String(sequence).padStart(12, '0')}`
  }

  const observationKey = (key: string): string =>
    createHash('sha256').update(`${label}\0${key}`).digest('hex')

  async function clean(): Promise<void> {
    for (const table of [
      'reply_publication_attempts',
      'reply_publication_authorizations',
      'outbox_events',
      'replies',
    ]) {
      await db.execute(
        sql`DELETE FROM ${sql.identifier(table)} WHERE organization_id = ${ORG}`,
      )
    }
    await db
      .delete(aiOrganizationCostWindows)
      .where(eq(aiOrganizationCostWindows.organizationId, ORG))
    await db.delete(properties).where(eq(properties.organizationId, ORG))
    await deleteTestOrganizations(db, [ORG])
  }

  async function controlHead(scopeKey: string) {
    const [head] = await db
      .select()
      .from(aiExecutionControlHeads)
      .where(eq(aiExecutionControlHeads.scopeKey, scopeKey))
      .limit(1)
    if (!head) throw new Error(`AI execution control is not seeded: ${scopeKey}`)
    return head
  }

  /** Move the reply-drafting control through the production adapter. */
  async function setReplyDrafting(target: 'enabled' | 'killed') {
    const head = await controlHead('capability:reply_drafting')
    if (head.executionState === target) return head
    const moved = await config.control.transition({
      scope: { kind: 'capability', capability: 'reply_drafting' },
      providerDeploymentProfileVersion: PROVIDER_PROFILE,
      expectedControlId: head.controlId,
      expectedGeneration: head.generation,
      executionState: target,
      admissionState: target === 'enabled' ? 'accepting' : 'draining',
      reasonCode: target === 'enabled' ? 'operator_restore' : 'operator_kill',
      actorUserId: config.operator,
      ticketReference: label,
      // The control function activates a capability only for a named release.
      candidateReleaseSha: target === 'enabled' ? RELEASE_SHA : null,
    })
    if (!moved) throw new Error(`Reply drafting control refused to become ${target}`)
    return moved
  }

  /** One Property with reply drafting authorized and a current profile. */
  async function seedProperty(): Promise<PropertyId> {
    const property = toPropertyId(nextId(1))
    const lineage = nextId(2)
    const now = new Date()
    await db.insert(properties).values({
      id: property,
      organizationId: ORG,
      name: `${label} property`,
      slug: `${label}-${sequence}`,
      timezone: 'America/New_York',
      countryCode: 'US',
      sourceEpoch: SOURCE_EPOCH,
    })
    await db.insert(reviewAiAnalysisHeads).values({
      organizationId: ORG,
      propertyId: property,
      sourceEpoch: SOURCE_EPOCH,
      headSequence: 11,
      createdAt: now,
      updatedAt: now,
    })
    await config.profiles.refreshForAi({ organizationId: ORG, propertyId: property })
    const authorization = {
      authorizationLineageId: lineage,
      organizationId: ORG,
      propertyId: property,
      state: 'enabled' as const,
      capabilities: ['reply_drafting'],
      capabilityRuntimeProfileVersions: { reply_drafting: 'reply-drafting-runtime-v1' },
      reviewAnalysisEpoch: 1,
      replyDraftingEpoch: 1,
      propertyTrendsEpoch: 1,
      authorizedSourceEpoch: SOURCE_EPOCH,
      analysisStartSequence: 11,
      stateVersion: 1,
      noticeVersion: MERCHANT_AI_NOTICE_VERSION,
      noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
      sourcePolicyId: 'google-business-profile-source-policy-v1',
      routingPolicyVersion: 1,
      processingRegion: 'global',
      providerDeploymentProfileVersion: PROVIDER_PROFILE,
      redactionProfileFamily: 'gbp-review-global-v1',
    }
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('repkey.merchant_ai_transition', '1', true)`)
      await tx.insert(merchantAiConsentEvidence).values({
        ...authorization,
        transitionKind: 'enable',
        actorUserId: APPROVER,
        reasonCode: 'merchant_enabled',
        idempotencyKey: `${label}-enable-${lineage}`,
        requestHash: 'c'.repeat(64),
        occurredAt: now,
      })
      await tx.insert(merchantAiEnablement).values({
        ...authorization,
        updatedBy: APPROVER,
        updatedAt: now,
      })
    })
    return property
  }

  async function seedReview(
    property: PropertyId,
  ): Promise<Omit<Review, 'createdAt' | 'updatedAt'>> {
    const now = new Date()
    const id = toReviewId(nextId(3))
    const review = {
      id,
      organizationId: ORG,
      propertyId: property,
      platform: 'google' as const,
      externalId: `${label}-review-${sequence}`,
      externalLocationId: GOOGLE_LOCATION_PRIMARY_RESOURCE,
      googleConnectionId: null,
      reviewerName: 'Guest',
      reviewerProfilePhotoUrl: null,
      googleReviewUrl: null,
      rating: 5 as const,
      text: 'A thoughtful review',
      translatedText: null,
      languageCode: 'en',
      reviewedAt: now,
      expiresAt: new Date(now.getTime() + 30 * DAY_MS),
      sentimentLabel: null,
      sentimentScore: null,
      sourceCreatedAt: now,
      sourceUpdatedAt: now,
      firstFetchedAt: now,
      lastFetchedAt: now,
      contentExpiresAt: new Date(now.getTime() + DAY_MS),
      contentHash: 'd'.repeat(64),
      sourceSeenGeneration: null,
      sourceEpoch: SOURCE_EPOCH,
      sourceRevision: 1,
      analysisSequence: 11,
      aiSourceByteLength: 20,
      aiSourceDigest: 'e'.repeat(64),
    }
    await config.reviewRepository.upsert(review, now, observationKey(`first:${id}`))
    return review
  }

  /** A settled reply-drafting operation bound to the controls as they stand. */
  async function seedOperation(
    property: PropertyId,
    review: ReviewId,
    lineage: string,
  ): Promise<Readonly<{ operationId: string; permitId: string }>> {
    const operationId = nextId(4)
    const permitId = nextId(5)
    const now = new Date()
    const [global, provider, capability] = await Promise.all([
      controlHead('global'),
      controlHead(`provider:${PROVIDER_PROFILE}`),
      controlHead('capability:reply_drafting'),
    ])
    await db
      .insert(aiOrganizationCostWindows)
      .values({
        id: permitId,
        organizationId: ORG,
        windowStart: sql`date_trunc('month', now())`,
        reservedMicros: 0,
        settledMicros: 42,
        capMicros: 50_000_000,
        updatedAt: sql`now()`,
      })
      .onConflictDoNothing()
    await db.insert(aiOperations).values({
      id: operationId,
      idempotencyScope: `reply:${operationId}`,
      idempotencyKey: operationId,
      requestFingerprint: 'f'.repeat(64),
      sourceDigest: 'e'.repeat(64),
      sourceByteCount: 20,
      command: 'reply',
      capability: 'reply_drafting',
      organizationId: ORG,
      propertyId: property,
      actorUserId: SUBMITTER,
      systemPrincipal: null,
      reviewId: review,
      sourceEpoch: SOURCE_EPOCH,
      sourceRevision: 1,
      reviewedAtEpochMillis: now.getTime(),
      tone: 'professional',
      baseReplyStateRevision: 0,
      authorizationLineageId: lineage,
      noticeVersion: MERCHANT_AI_NOTICE_VERSION,
      noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
      propertyProfileVersion: 1,
      routingPolicyVersion: 1,
      providerDeploymentProfileVersion: PROVIDER_PROFILE,
      operationProfileVersion: 'reply-suggestion-v1',
      capabilityRuntimeProfileVersion: 'reply-drafting-runtime-v1',
      replyBrandProfileVersion: null,
      replyBrandDisplayNameDigest: null,
      sourcePolicyId: 'google-business-profile-source-policy-v1',
      redactionProfileVersion: 'gbp-review-global-v1',
      concreteReplyLanguageTag: 'en-Latn-US',
      concreteReplyTemplateGroup: 'en-Latn',
      outputLeakageProfileVersion: 'ai-output-leakage-v1',
      outputLeakageProfileDigest: 'a'.repeat(64),
      replyTemplateCatalogueVersion: 'gbp-reply-template-catalogue-v1',
      replyTemplateCatalogueDigest: AI_REPLY_TEMPLATE_CATALOGUE_DIGEST,
      capabilityFences: {
        capability: 'reply_drafting',
        replyDraftingEpoch: 1,
        baseReplyStateRevision: 0,
      },
      globalControlId: global.controlId,
      globalControlGeneration: global.generation,
      providerControlId: provider.controlId,
      providerControlGeneration: provider.generation,
      capabilityControlId: capability.controlId,
      capabilityControlGeneration: capability.generation,
      routeKey: 'reply-suggestion',
      executionPermitId: permitId,
      costWindowId: permitId,
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
    return { operationId, permitId }
  }

  async function authorizationLineage(property: PropertyId): Promise<string> {
    const [row] = await db
      .select({ lineage: merchantAiEnablement.authorizationLineageId })
      .from(merchantAiEnablement)
      .where(eq(merchantAiEnablement.propertyId, property))
      .limit(1)
    if (!row) throw new Error('Merchant AI enablement is not seeded')
    return row.lineage
  }

  /** Submit a draft for approval through the reply command store. */
  function submitForApproval(
    draft: Reply,
    property: PropertyId,
    now: Date,
  ): Promise<Reply | null> {
    return config.replyCommandStore.submitReply(
      draft,
      { status: 'pending_approval', submittedAt: now, submittedBy: SUBMITTER },
      reviewReplySubmitted({
        replyId: draft.id,
        reviewId: draft.reviewId,
        propertyId: property,
        organizationId: ORG,
        userId: SUBMITTER,
        occurredAt: now,
      }),
      now,
    )
  }

  /** The provenance token the operation's adopter presents for `review`. */
  function provenanceToken(
    operationId: string,
    permitId: string,
    property: PropertyId,
    review: ReviewId,
    now: Date,
  ): string {
    return signAiReplyProvenance(
      {
        version: 'ai-reply-provenance-v1',
        kid: 'provenance-v1',
        operationId,
        actorId: SUBMITTER,
        organizationId: ORG,
        propertyId: property,
        reviewId: review,
        executionPermitId: permitId,
        executionAttempt: 1,
        sourceEpoch: SOURCE_EPOCH,
        sourceRevision: 1,
        baseReplyStateRevision: 0,
        replyDraftingEpoch: 1,
        propertyProfileVersion: 1,
        providerDeploymentProfileVersion: PROVIDER_PROFILE,
        operationProfileVersion: 'reply-suggestion-v1',
        modelSnapshot: 'gpt-5.4-mini-2026-03-17',
        promptVersion: 'reply-suggestion-prompt-v1',
        outputLeakageProfileVersion: 'ai-output-leakage-v1',
        outputLeakageProfileDigest: 'a'.repeat(64),
        replyTemplateCatalogueVersion: 'gbp-reply-template-catalogue-v1',
        replyTemplateCatalogueDigest: AI_REPLY_TEMPLATE_CATALOGUE_DIGEST,
        templateId: 'appreciation_positive',
        concreteLanguageTag: 'en-Latn-US',
        templateGroup: 'en-Latn',
        renderedSuggestionDigest: digestRenderedReply(SUGGESTION),
        tokenExpiresAtEpochMillis: now.getTime() + 5 * MINUTE_MS,
        draftExpiresAtEpochMillis: now.getTime() + 30 * MINUTE_MS,
      },
      config.privateKey,
    )
  }

  /**
   * Adopt an AI suggestion for a fresh Review and take it as far as `stage`:
   * a draft, submitted for approval, or confirmed and waiting for the worker.
   */
  async function seedAiReply(
    stage: ReplyStage,
    inProperty?: PropertyId,
  ): Promise<SeededReply> {
    const property = inProperty ?? (await seedProperty())
    const review = await seedReview(property)
    const { operationId, permitId } = await seedOperation(
      property,
      review.id,
      await authorizationLineage(property),
    )
    const now = new Date()
    const accepted = await config.draftStore.accept({
      organizationId: ORG,
      propertyId: property,
      reviewId: review.id,
      actorUserId: SUBMITTER,
      text: SUGGESTION,
      provenanceToken: provenanceToken(operationId, permitId, property, review.id, now),
      now,
    })
    if (accepted.status !== 'accepted') {
      throw new Error(`AI suggestion was not adopted: ${accepted.reason}`)
    }
    if (stage === 'draft') return { property, review, reply: accepted.reply, operationId }

    const pending = await submitForApproval(accepted.reply, property, now)
    if (!pending) throw new Error('AI-assisted draft could not be submitted')
    if (stage === 'pending_approval')
      return { property, review, reply: pending, operationId }

    const facts = {
      replyId: pending.id,
      reviewId: review.id,
      propertyId: property,
      organizationId: ORG,
      userId: APPROVER,
      occurredAt: now,
    }
    const authorized = await config.replyCommandStore.markPublicationAuthorized(
      pending,
      { status: 'approved', approvedBy: APPROVER, approvedAt: now },
      {
        lifecycleEvent: reviewReplyApproved({ ...facts, authorId: SUBMITTER }),
        publicationIntent: reviewReplyPublicationRequested({
          ...facts,
          publicationCycle: 1,
          sourceEpoch: SOURCE_EPOCH,
          materialReviewRevision: 1,
          baseObservationRevision: 0,
        }),
      },
      now,
    )
    if (authorized?.publicationState !== 'authorized') {
      throw new Error('AI-assisted reply could not be confirmed for publication')
    }
    return { property, review, reply: authorized, operationId }
  }

  /** The reply as it is stored now: a guarded write names the row it read. */
  async function storedReply(seeded: Pick<SeededReply, 'reply'>): Promise<Reply> {
    const reply = await config.replyRepository.findById(seeded.reply.id, ORG)
    if (!reply) throw new Error('The reply is gone')
    return reply
  }

  async function replyRows(review: ReviewId) {
    const result = await db.execute(sql`
      SELECT status::text AS status, publication_state, text, authorship::text AS authorship,
             origin_operation_id, reconcile_due_at
      FROM replies
      WHERE review_id = ${review}::uuid AND organization_id = ${ORG}
    `)
    return result.rows
  }

  async function authorizationCount(reply: Reply): Promise<number> {
    const result = await db.execute<{ total: number }>(sql`
      SELECT count(*)::int AS total
      FROM reply_publication_authorizations
      WHERE reply_id = ${reply.id}::uuid AND organization_id = ${ORG}
    `)
    return result.rows[0]?.total ?? 0
  }

  async function attemptRows(reply: Reply) {
    const result = await db.execute(sql`
      SELECT attempt_number, outcome
      FROM reply_publication_attempts
      WHERE reply_id = ${reply.id}::uuid AND organization_id = ${ORG}
    `)
    return result.rows
  }

  async function cancellationFacts() {
    const result = await db.execute(sql`
      SELECT payload->>'replyId' AS reply_id,
             payload->>'propertyId' AS property_id,
             payload->>'authorId' AS author_id,
             payload->>'cause' AS cause
      FROM outbox_events
      WHERE organization_id = ${ORG}
        AND event_type = 'review.reply.publication_cancelled'
      ORDER BY payload->>'cause'
    `)
    return result.rows
  }

  async function adoptionDisposition(operationId: string) {
    const [row] = await db
      .select({ disposition: aiOperations.replyAdoptionDisposition })
      .from(aiOperations)
      .where(eq(aiOperations.id, operationId))
      .limit(1)
    return row?.disposition
  }

  const withdrawalFact = (seeded: SeededReply) => ({
    reply_id: seeded.reply.id,
    property_id: seeded.property,
    author_id: SUBMITTER,
    cause: 'ai_draft_withdrawn',
  })

  /**
   * Let the reply's AI draft binding run out of time, as it does when the
   * adoption window closes ten minutes after the suggestion was issued. Nothing
   * about the Review, the Property or the AI settings changes.
   */
  async function expireAiDraft(seeded: SeededReply): Promise<void> {
    await db.execute(sql`
      UPDATE replies
      SET ai_draft_expires_at = transaction_timestamp() - interval '1 second'
      WHERE id = ${seeded.reply.id}::uuid AND organization_id = ${ORG}
    `)
  }

  /** Sync lists the Review again with nothing about it changed. */
  async function observeUnchanged(
    seeded: SeededReply,
    provider: Partial<Pick<Review, 'sourceUpdatedAt'>> = {},
  ): Promise<void> {
    const observedAt = new Date()
    await config.reviewRepository.upsert(
      { ...seeded.review, ...provider, lastFetchedAt: observedAt },
      observedAt,
      observationKey(`again:${seeded.review.id}`),
    )
  }

  /**
   * Sync sees the guest's edit: a new Material Review Revision is recorded. A
   * guest edit moves Google's updateTime past the stored one; the same
   * difference at an unmoved one is Google rewording the review and keeps the
   * revision, so the edit is a second after the seeded read.
   */
  async function observeGuestEdit(seeded: SeededReply): Promise<Review> {
    const observedAt = new Date()
    const editedAt = new Date(
      (seeded.review.sourceUpdatedAt ?? observedAt).getTime() + 1000,
    )
    return config.reviewCommandStore.upsertAndRecord(
      {
        ...seeded.review,
        rating: 2,
        text: 'The guest changed their mind',
        sourceUpdatedAt: editedAt,
        lastFetchedAt: observedAt,
      },
      (review) =>
        reviewUpdated({
          reviewId: review.id,
          organizationId: ORG,
          propertyId: seeded.property,
          platform: 'google',
          sourceEpoch: review.sourceEpoch,
          sourceRevision: review.sourceRevision,
          analysisSequence: review.analysisSequence,
          occurredAt: observedAt,
        }),
      observedAt,
      observationKey(`edit:${seeded.review.id}`),
      'ongoing',
    )
  }

  return {
    nextId,
    observationKey,
    clean,
    controlHead,
    setReplyDrafting,
    seedProperty,
    seedReview,
    seedOperation,
    authorizationLineage,
    submitForApproval,
    seedAiReply,
    storedReply,
    replyRows,
    authorizationCount,
    attemptRows,
    cancellationFacts,
    adoptionDisposition,
    withdrawalFact,
    expireAiDraft,
    observeUnchanged,
    observeGuestEdit,
  }
}
