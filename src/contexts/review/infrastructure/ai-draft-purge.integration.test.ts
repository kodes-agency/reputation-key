// The AI draft purge against real PostgreSQL.
//
// An AI-assisted reply is the unedited output of one AI operation. The purge
// withdraws it when something it was generated from changes. Two things used
// to go wrong, and both are pinned here:
//   - a reply a manager had confirmed (publication_state 'authorized') has an
//     immutable authorization row that restricts its deletion, so the purge's
//     DELETE raised and took the caller's transaction with it: the AI kill
//     switch, a consent or processing-profile change, a Property archive,
//     source erasure and review sync all failed while one such reply waited;
//   - every re-observation of a Review ran the purge, so an AI-assisted draft
//     or a reply awaiting approval vanished the next time sync listed the
//     unchanged Review.
// The fix for the second must not strand a reply: the binding also ends by
// time alone, and the next observation is the only thing that withdraws a
// reply whose time has run out. That, and what a guest edit leaves of a reply
// the worker had already claimed, are pinned here too.
//
// Every reply here is adopted through the real AI draft store and confirmed
// through the real reply command store, so the rows are the ones production
// writes.

import { createHash, generateKeyPairSync } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { AI_REPLY_TEMPLATE_CATALOGUE_DIGEST } from '#/shared/ai-reply-template-catalogue'
import { digestRenderedReply, signAiReplyProvenance } from '#/shared/ai-reply-provenance'
import {
  purgeAiDraftsForAuthorization,
  purgeAiDraftsForControl,
  purgeAiDraftsForOrganization,
  purgeAiDraftsForProfile,
  purgeAiDraftsForProperty,
  purgeAiDraftsForReview,
} from '#/shared/db/ai/ai-draft-purge'
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
  organizationId,
  propertyId,
  reviewId,
  userId,
  type PropertyId,
  type ReviewId,
} from '#/shared/domain/ids'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'
import type { Tx } from '#/shared/outbox/commit'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { GOOGLE_LOCATION_PRIMARY_RESOURCE } from '#/test-fixtures/generated/google-provider-identifiers-v1'
import { createAiControlAdapter } from '#/contexts/ai/infrastructure/adapters/ai-control.adapter'
import { createPropertyProcessingProfileAdapter } from '#/contexts/ai/infrastructure/adapters/property-processing-profile.adapter'
import { propertyArchived } from '#/contexts/property/domain/events'
import { createPropertyLifecycleCommandStore } from '#/contexts/property/infrastructure/property-lifecycle-command-store'
import {
  reviewReplyApproved,
  reviewReplyPublicationCancelled,
  reviewReplyPublicationRequested,
  reviewReplySubmitted,
  reviewUpdated,
} from '../domain/events'
import type { Reply, Review } from '../domain/types'
import { createAiSuggestedDraftStore } from './ai-suggested-draft-store'
import { createAtomicReplyCommandStore } from './reply-command-store'
import { createReplyRepository } from './repositories/reply.repository'
import { createReviewRepository } from './repositories/review.repository'
import { createAtomicReviewCommandStore } from './review-command-store'
import { eraseReviewSourceContent } from './review-source-content-store'

const ORG = organizationId('ai-draft-purge-test-org')
const SUBMITTER = userId('ai-draft-purge-submitter')
const APPROVER = userId('ai-draft-purge-approver')
const OPERATOR = 'ai-draft-purge-operator'
const SOURCE_EPOCH = 2
const PROVIDER_PROFILE = 'private-beta-global-v1'
const RELEASE_SHA = 'a'.repeat(40)
const SUGGESTION = 'Thank you for sharing your experience.'
const REQUEST_BINDING_HMAC = 'A'.repeat(43)
const MINUTE_MS = 60_000
const DAY_MS = 24 * 60 * MINUTE_MS

type Stage = 'draft' | 'pending_approval' | 'authorized'

type SeededReply = Readonly<{
  property: PropertyId
  review: Omit<Review, 'createdAt' | 'updatedAt'>
  reply: Reply
  operationId: string
}>

const { privateKey, publicKey } = generateKeyPairSync('ed25519')

const db = getDb()
const reviewRepository = createReviewRepository(db, () => new Date())
const replyRepository = createReplyRepository(db, () => new Date())
const replyCommandStore = createAtomicReplyCommandStore(
  db,
  () => new Date(),
  async () => true,
)
const draftStore = createAiSuggestedDraftStore(
  db,
  new Map([['provenance-v1', publicKey]]),
  { isCurrentAiReplyBrandProfile: async () => true },
)
const profiles = createPropertyProcessingProfileAdapter(db, () => new Date())
const control = createAiControlAdapter(db)

let sequence = 0
/** A UUID no other row in this file uses; `kind` keeps the families apart. */
const nextId = (kind: number): string => {
  sequence += 1
  return `75000000-0000-4000-8${String(kind).padStart(3, '0')}-${String(sequence).padStart(12, '0')}`
}

const observationKey = (label: string): string =>
  createHash('sha256').update(`ai-draft-purge\0${label}`).digest('hex')

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
  const moved = await control.transition({
    scope: { kind: 'capability', capability: 'reply_drafting' },
    providerDeploymentProfileVersion: PROVIDER_PROFILE,
    expectedControlId: head.controlId,
    expectedGeneration: head.generation,
    executionState: target,
    admissionState: target === 'enabled' ? 'accepting' : 'draining',
    reasonCode: target === 'enabled' ? 'operator_restore' : 'operator_kill',
    actorUserId: OPERATOR,
    ticketReference: 'ai-draft-purge-test',
    // The control function activates a capability only for a named release.
    candidateReleaseSha: target === 'enabled' ? RELEASE_SHA : null,
  })
  if (!moved) throw new Error(`Reply drafting control refused to become ${target}`)
  return moved
}

/** One Property with reply drafting authorized and a current profile. */
async function seedProperty(): Promise<PropertyId> {
  const property = propertyId(nextId(1))
  const lineage = nextId(2)
  const now = new Date()
  await db.insert(properties).values({
    id: property,
    organizationId: ORG,
    name: 'AI draft purge property',
    slug: `ai-draft-purge-${sequence}`,
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
  await profiles.refreshForAi({ organizationId: ORG, propertyId: property })
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
      idempotencyKey: `ai-draft-purge-enable-${lineage}`,
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
  const id = reviewId(nextId(3))
  const review = {
    id,
    organizationId: ORG,
    propertyId: property,
    platform: 'google' as const,
    externalId: `ai-draft-purge-review-${sequence}`,
    externalLocationId: GOOGLE_LOCATION_PRIMARY_RESOURCE,
    googleConnectionId: null,
    reviewerName: 'Guest',
    reviewerProfilePhotoUrl: null,
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
  await reviewRepository.upsert(review, now, observationKey(`first:${id}`))
  return review
}

/** A settled reply-drafting operation bound to the controls as they stand. */
async function seedOperation(
  property: PropertyId,
  review: ReviewId,
  lineage: string,
): Promise<string> {
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
    admissionNonce: `nonce-${operationId}`,
    requestBindingKeyId: 'binding-v1',
    requestBindingHmac: REQUEST_BINDING_HMAC,
    grantKid: 'grant-v1',
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
  return operationId
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

/** The reply as it is stored now: a guarded write names the row it read. */
async function storedReply(seeded: Pick<SeededReply, 'reply'>): Promise<Reply> {
  const reply = await replyRepository.findById(seeded.reply.id, ORG)
  if (!reply) throw new Error('The reply is gone')
  return reply
}

/** Submit a draft for approval through the reply command store. */
function submitForApproval(
  draft: Reply,
  property: PropertyId,
  now: Date,
): Promise<Reply | null> {
  return replyCommandStore.submitReply(
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

/**
 * Adopt an AI suggestion for a fresh Review and take it as far as `stage`:
 * a draft, submitted for approval, or confirmed and waiting for the worker.
 */
async function seedAiReply(stage: Stage, inProperty?: PropertyId): Promise<SeededReply> {
  const property = inProperty ?? (await seedProperty())
  const review = await seedReview(property)
  const operationId = await seedOperation(
    property,
    review.id,
    await authorizationLineage(property),
  )
  const now = new Date()
  const accepted = await draftStore.accept({
    organizationId: ORG,
    propertyId: property,
    reviewId: review.id,
    actorUserId: SUBMITTER,
    text: SUGGESTION,
    provenanceToken: signAiReplyProvenance(
      {
        version: 'ai-reply-provenance-v1',
        kid: 'provenance-v1',
        operationId,
        actorId: SUBMITTER,
        organizationId: ORG,
        propertyId: property,
        reviewId: review.id,
        requestBindingHmac: REQUEST_BINDING_HMAC,
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
      privateKey,
    ),
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
  const authorized = await replyCommandStore.markPublicationAuthorized(
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
  await reviewRepository.upsert(
    { ...seeded.review, ...provider, lastFetchedAt: observedAt },
    observedAt,
    observationKey(`again:${seeded.review.id}`),
  )
}

async function attemptRows(reply: Reply) {
  const result = await db.execute(sql`
    SELECT attempt_number, outcome
    FROM reply_publication_attempts
    WHERE reply_id = ${reply.id}::uuid AND organization_id = ${ORG}
  `)
  return result.rows
}

/** The publish worker's claim, with the fences the reply was confirmed under. */
function claimForDispatch(seeded: SeededReply): Promise<Reply | null> {
  return replyCommandStore.markPublicationSending(seeded.reply, {
    propertyId: seeded.property,
    sourceEpoch: SOURCE_EPOCH,
    materialReviewRevision: 1,
    baseObservationRevision: 0,
    providerOperationKey: `ai-draft-purge:${seeded.reply.id}:1`,
  })
}

/** Sync sees the guest's edit: a new Material Review Revision is recorded. */
async function observeGuestEdit(seeded: SeededReply): Promise<Review> {
  const observedAt = new Date()
  return createAtomicReviewCommandStore(db, () => new Date()).upsertAndRecord(
    {
      ...seeded.review,
      rating: 2,
      text: 'The guest changed their mind',
      sourceUpdatedAt: observedAt,
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

/** What the purge leaves of a confirmed reply: an empty draft, no AI claim. */
const WITHDRAWN = {
  status: 'draft',
  publication_state: 'cancelled',
  text: '',
  authorship: 'human',
  origin_operation_id: null,
  reconcile_due_at: null,
}

const withdrawalFact = (seeded: SeededReply) => ({
  reply_id: seeded.reply.id,
  property_id: seeded.property,
  author_id: SUBMITTER,
  cause: 'ai_draft_withdrawn',
})

/** The reply is withdrawn and everything that proves it was confirmed stays. */
async function expectWithdrawnWithEvidence(seeded: SeededReply): Promise<void> {
  expect(await replyRows(seeded.review.id)).toEqual([WITHDRAWN])
  expect(await authorizationCount(seeded.reply)).toBe(1)
  expect(await cancellationFacts()).toEqual([withdrawalFact(seeded)])
  expect(await adoptionDisposition(seeded.operationId)).toBe('invalidated')
}

type PurgeEntryPoint = (tx: Tx, seeded: SeededReply) => Promise<void>

const PURGE_ENTRY_POINTS: ReadonlyArray<readonly [string, PurgeEntryPoint]> = [
  [
    'a Property change',
    (tx, s) =>
      purgeAiDraftsForProperty(tx, { organizationId: ORG, propertyId: s.property }),
  ],
  [
    'a processing-profile change',
    (tx, s) =>
      purgeAiDraftsForProfile(tx, { organizationId: ORG, propertyId: s.property }),
  ],
  [
    'an AI Authorization change',
    (tx, s) =>
      purgeAiDraftsForAuthorization(tx, {
        organizationId: ORG,
        propertyId: s.property,
      }),
  ],
  ['an Organization closing', (tx) => purgeAiDraftsForOrganization(tx, ORG)],
  [
    'a Review change',
    (tx, s) => purgeAiDraftsForReview(tx, { organizationId: ORG, reviewId: s.review.id }),
  ],
  ['the global AI control', (tx) => purgeAiDraftsForControl(tx, 'global', null)],
  [
    'the provider AI control',
    (tx) => purgeAiDraftsForControl(tx, 'provider_deployment_profile', PROVIDER_PROFILE),
  ],
  [
    'the reply-drafting AI control',
    (tx) => purgeAiDraftsForControl(tx, 'capability', 'reply_drafting'),
  ],
]

let initialReplyDrafting: 'enabled' | 'killed'

beforeAll(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  const head = await controlHead('capability:reply_drafting')
  initialReplyDrafting = head.executionState === 'enabled' ? 'enabled' : 'killed'
  await setReplyDrafting('enabled')
})

afterAll(async () => {
  await clean()
  await setReplyDrafting(initialReplyDrafting)
  clearEventSchemas()
})

beforeEach(async () => {
  await clean()
  await db.execute(sql`
    INSERT INTO organization (id, name, slug, "createdAt")
    VALUES (${ORG}, 'AI draft purge test', ${ORG}, now())
  `)
})

describe.sequential('AI draft purge (real PostgreSQL)', () => {
  describe('a confirmed AI-assisted reply that has not been dispatched', () => {
    it.each(PURGE_ENTRY_POINTS)(
      'the purge for %s withdraws it and keeps the publication evidence',
      async (_label, purge) => {
        const seeded = await seedAiReply('authorized')

        await db.transaction((tx) => purge(tx, seeded))

        await expectWithdrawnWithEvidence(seeded)
      },
    )

    it('lets the AI kill switch apply', async () => {
      const seeded = await seedAiReply('authorized')

      const killed = await setReplyDrafting('killed')
      await setReplyDrafting('enabled')

      expect(killed).toMatchObject({
        executionState: 'killed',
        admissionState: 'draining',
      })
      await expectWithdrawnWithEvidence(seeded)
    })

    it('lets a processing-profile change apply', async () => {
      const seeded = await seedAiReply('authorized')
      await db
        .update(properties)
        .set({ timezone: 'Europe/Sofia' })
        .where(eq(properties.id, seeded.property))

      const refreshed = await profiles.refreshForAi({
        organizationId: ORG,
        propertyId: seeded.property,
      })

      expect(refreshed).toMatchObject({
        status: 'available',
        profile: { profileVersion: 2 },
      })
      await expectWithdrawnWithEvidence(seeded)
    })

    it('lets the Property be archived', async () => {
      const seeded = await seedAiReply('authorized')
      const occurredAt = new Date()
      const recoveryDeadline = new Date(occurredAt.getTime() + 30 * DAY_MS)
      const [property] = await db
        .select({ profileVersion: properties.profileVersion })
        .from(properties)
        .where(eq(properties.id, seeded.property))
        .limit(1)

      const archived = await createPropertyLifecycleCommandStore(db).transitionLifecycle({
        organizationId: ORG,
        propertyId: seeded.property,
        expectedSourceEpoch: SOURCE_EPOCH,
        nextSourceEpoch: SOURCE_EPOCH + 1,
        expectedProfileVersion: property!.profileVersion,
        initiatedBy: APPROVER,
        occurredAt,
        from: 'active',
        to: 'archived',
        reason: 'archived_by_manager',
        recoveryDeadline,
        event: propertyArchived({
          organizationId: ORG,
          propertyId: seeded.property,
          userId: APPROVER,
          previousState: 'active',
          sourceEpoch: SOURCE_EPOCH + 1,
          recoveryDeadline,
          occurredAt,
        }),
      })

      expect(archived).toMatchObject({ lifecycleState: 'archived' })
      await expectWithdrawnWithEvidence(seeded)
    })

    it('lets the Review source content be erased', async () => {
      const seeded = await seedAiReply('authorized')

      const erased = await db.transaction((tx) =>
        eraseReviewSourceContent(tx, {
          reviewId: seeded.review.id,
          organizationId: ORG,
          propertyId: seeded.property,
          sourceEpoch: SOURCE_EPOCH,
          expectedSourceRevision: 1,
          state: 'source_expired',
        }),
      )

      expect(erased).toBe(true)
      await expectWithdrawnWithEvidence(seeded)
    })

    // A retryable failure sends the cycle back to `authorized` with one
    // attempt on record. Cancelling it supersedes that attempt, as every other
    // cancellation does, and deletes nothing.
    it('supersedes the attempt of a cycle that was waiting to be retried', async () => {
      const seeded = await seedAiReply('authorized')
      const sending = await claimForDispatch(seeded)
      if (!sending) throw new Error('The publish worker could not claim the cycle')
      const requeued = await replyCommandStore.markPublicationRetryQueued(sending)
      expect(requeued).toMatchObject({
        publicationState: 'authorized',
        publicationAttempts: 1,
      })

      await db.transaction((tx) =>
        purgeAiDraftsForProperty(tx, {
          organizationId: ORG,
          propertyId: seeded.property,
        }),
      )

      await expectWithdrawnWithEvidence(seeded)
      expect(await attemptRows(seeded.reply)).toEqual([
        { attempt_number: 1, outcome: 'superseded' },
      ])
    })

    // What is left is an ordinary empty draft, so the Review can be answered
    // from RepKey again: a Review holds one internal reply, and this is it.
    it('leaves a draft a manager can write a new reply into', async () => {
      const seeded = await seedAiReply('authorized')
      await db.transaction((tx) =>
        purgeAiDraftsForProperty(tx, {
          organizationId: ORG,
          propertyId: seeded.property,
        }),
      )

      const rewritten = await replyRepository.saveDraft(
        await storedReply(seeded),
        { text: 'A reply written by hand' },
        new Date(),
      )

      expect(rewritten).toMatchObject({
        status: 'draft',
        text: 'A reply written by hand',
        aiGenerated: false,
      })
      expect(await authorizationCount(seeded.reply)).toBe(1)
    })

    // The publish job reads the reply before it claims it. A purge that commits
    // in between must leave that copy unclaimable: the withdrawn row no longer
    // claims AI authorship, so the binding check alone would let it through.
    it('cannot be claimed by a publish job that read it before the purge', async () => {
      const seeded = await seedAiReply('authorized')
      await db.transaction((tx) =>
        purgeAiDraftsForProperty(tx, {
          organizationId: ORG,
          propertyId: seeded.property,
        }),
      )

      const claimed = await claimForDispatch(seeded)

      expect(claimed).toBeNull()
      expect(await attemptRows(seeded.reply)).toEqual([])
      expect(await replyRows(seeded.review.id)).toEqual([WITHDRAWN])
    })

    it('lets a guest edit be observed, and withdraws it once', async () => {
      const seeded = await seedAiReply('authorized')

      const saved = await observeGuestEdit(seeded)

      expect(saved).toMatchObject({ sourceRevision: 2 })
      await expectWithdrawnWithEvidence(seeded)
    })

    it('stays confirmed when the unchanged Review is observed again', async () => {
      const seeded = await seedAiReply('authorized')

      await observeUnchanged(seeded)

      expect(await replyRows(seeded.review.id)).toMatchObject([
        {
          status: 'approved',
          publication_state: 'authorized',
          text: SUGGESTION,
          authorship: 'ai_assisted',
        },
      ])
      expect(await cancellationFacts()).toEqual([])
    })

    // The publish worker refuses to claim a reply whose binding ran out, so
    // without this it would wait in `authorized` for good.
    it('is withdrawn by the next observation once its time has run out', async () => {
      const seeded = await seedAiReply('authorized')
      await expireAiDraft(seeded)

      await observeUnchanged(seeded)

      await expectWithdrawnWithEvidence(seeded)
    })
  })

  // The worker has claimed these, so the purge itself never touches them: the
  // text may be on Google. A guest edit stops the cycle and returns the reply
  // to draft, and that draft still holds AI text written for the old revision.
  describe('an AI-assisted reply that was dispatched', () => {
    it('is emptied when a guest edit stops its publication, with one notice', async () => {
      const seeded = await seedAiReply('authorized')
      const sending = await claimForDispatch(seeded)
      expect(sending).toMatchObject({ publicationState: 'sending' })

      const saved = await observeGuestEdit(seeded)

      expect(saved).toMatchObject({ sourceRevision: 2 })
      expect(await replyRows(seeded.review.id)).toEqual([WITHDRAWN])
      expect(await authorizationCount(seeded.reply)).toBe(1)
      expect(await attemptRows(seeded.reply)).toEqual([
        { attempt_number: 1, outcome: 'superseded' },
      ])
      expect(await cancellationFacts()).toEqual([
        { ...withdrawalFact(seeded), cause: 'source_changed' },
      ])
    })

    it('keeps its text when the unchanged Review is observed after its time ran out', async () => {
      const seeded = await seedAiReply('authorized')
      const sending = await claimForDispatch(seeded)
      expect(sending).toMatchObject({ publicationState: 'sending' })
      await expireAiDraft(seeded)

      await observeUnchanged(seeded)

      expect(await replyRows(seeded.review.id)).toMatchObject([
        {
          status: 'approved',
          publication_state: 'sending',
          text: SUGGESTION,
          authorship: 'ai_assisted',
        },
      ])
      expect(await cancellationFacts()).toEqual([])
    })
  })

  describe('an AI-assisted reply nobody has confirmed', () => {
    it.each(['draft', 'pending_approval'] as const)(
      'survives another observation of the unchanged Review (%s)',
      async (stage) => {
        const seeded = await seedAiReply(stage)

        await observeUnchanged(seeded)

        expect(await replyRows(seeded.review.id)).toMatchObject([
          { status: stage, text: SUGGESTION, authorship: 'ai_assisted' },
        ])
        expect(await adoptionDisposition(seeded.operationId)).toBe('adopted')
        await expect(
          draftStore.assertCurrentBinding({
            organizationId: ORG,
            replyId: seeded.reply.id,
          }),
        ).resolves.toBe('current')
      },
    )

    // The binding also ends by time alone, and no transaction marks that
    // moment. Once it has, nobody can approve, reject or rewrite the reply, and
    // a Review holds one internal reply, so the Review could not be answered
    // from RepKey. The next observation is what takes it away.
    it.each([
      ['draft', 0],
      ['pending_approval', 1],
    ] as const)(
      'is withdrawn by the next observation once its time has run out (%s)',
      async (stage, expectedFacts) => {
        const seeded = await seedAiReply(stage)
        await expireAiDraft(seeded)
        await expect(
          draftStore.assertCurrentBinding({
            organizationId: ORG,
            replyId: seeded.reply.id,
          }),
        ).resolves.toBe('stale')

        await observeUnchanged(seeded)

        expect(await replyRows(seeded.review.id)).toEqual([])
        expect(await cancellationFacts()).toEqual(
          Array.from({ length: expectedFacts }, () => withdrawalFact(seeded)),
        )
      },
    )

    // Older provider evidence is recorded and never applied, but it is still
    // sync seeing the Review, and a Review Google keeps answering with an old
    // version would otherwise never release the reply.
    it('is withdrawn once its time has run out even by an out-of-order observation', async () => {
      const seeded = await seedAiReply('pending_approval')
      await expireAiDraft(seeded)

      await observeUnchanged(seeded, {
        sourceUpdatedAt: new Date(seeded.review.sourceUpdatedAt!.getTime() - DAY_MS),
      })

      const latest = await db.execute(sql`
        SELECT comparison_result
        FROM review_source_observations
        WHERE review_id = ${seeded.review.id}::uuid AND organization_id = ${ORG}
        ORDER BY observation_sequence DESC
        LIMIT 1
      `)
      expect(latest.rows).toEqual([{ comparison_result: 'out_of_order_ignored' }])
      expect(await replyRows(seeded.review.id)).toEqual([])
      expect(await cancellationFacts()).toEqual([withdrawalFact(seeded)])
    })

    // The edit is its own record: `review.updated` carries the new revision and
    // reopens the Inbox item. Only a reply someone was waiting on needs a fact
    // of its own.
    it.each([
      ['draft', 0],
      ['pending_approval', 1],
    ] as const)(
      'is withdrawn when the guest edits the Review (%s)',
      async (stage, expectedFacts) => {
        const seeded = await seedAiReply(stage)

        const saved = await observeGuestEdit(seeded)

        expect(saved).toMatchObject({ sourceRevision: 2 })
        expect(await replyRows(seeded.review.id)).toEqual([])
        expect(await cancellationFacts()).toEqual(
          Array.from({ length: expectedFacts }, () => withdrawalFact(seeded)),
        )
        expect(await adoptionDisposition(seeded.operationId)).toBe('invalidated')
      },
    )

    it('is deleted without a notice while it is still a draft', async () => {
      const seeded = await seedAiReply('draft')

      await db.transaction((tx) =>
        purgeAiDraftsForProperty(tx, {
          organizationId: ORG,
          propertyId: seeded.property,
        }),
      )

      expect(await replyRows(seeded.review.id)).toEqual([])
      expect(await cancellationFacts()).toEqual([])
      expect(await adoptionDisposition(seeded.operationId)).toBe('invalidated')
    })

    it('is deleted, and the people waiting on it are told, once it was submitted', async () => {
      const seeded = await seedAiReply('pending_approval')

      await db.transaction((tx) =>
        purgeAiDraftsForProperty(tx, {
          organizationId: ORG,
          propertyId: seeded.property,
        }),
      )

      expect(await replyRows(seeded.review.id)).toEqual([])
      expect(await cancellationFacts()).toEqual([withdrawalFact(seeded)])
    })
  })

  describe('an AI-assisted reply back in draft after a cancelled cycle', () => {
    /** Confirm a reply, then stop its cycle the way a policy stop does. */
    async function seedCancelledAiReply(): Promise<SeededReply> {
      const seeded = await seedAiReply('authorized')
      const now = new Date()
      const cancelled = await replyCommandStore.cancelPublications([
        {
          reply: seeded.reply,
          event: reviewReplyPublicationCancelled({
            replyId: seeded.reply.id,
            reviewId: seeded.review.id,
            propertyId: seeded.property,
            organizationId: ORG,
            authorId: SUBMITTER,
            cause: 'policy',
            occurredAt: now,
          }),
          now,
        },
      ])
      if (cancelled !== 1) throw new Error('The publication cycle was not cancelled')
      return seeded
    }

    const policyFact = (seeded: SeededReply) => ({
      ...withdrawalFact(seeded),
      cause: 'policy',
    })

    it('is emptied, not deleted, because its authorization still references it', async () => {
      const seeded = await seedCancelledAiReply()
      expect(await replyRows(seeded.review.id)).toMatchObject([
        { status: 'draft', publication_state: 'cancelled', text: SUGGESTION },
      ])

      await db.transaction((tx) =>
        purgeAiDraftsForProperty(tx, {
          organizationId: ORG,
          propertyId: seeded.property,
        }),
      )

      expect(await replyRows(seeded.review.id)).toEqual([WITHDRAWN])
      expect(await authorizationCount(seeded.reply)).toBe(1)
      expect(await cancellationFacts()).toEqual([policyFact(seeded)])
    })

    // The emptying leaves the draft a draft, in the same cancelled cycle. A
    // Submit that read the AI text before the purge names the reply it read,
    // state revision included, so it does not hand an approver a reply with
    // no text.
    it('is not submitted, blank, by a Submit that read it before the purge', async () => {
      const seeded = await seedCancelledAiReply()
      const readBySubmit = await storedReply(seeded)
      await db.transaction((tx) =>
        purgeAiDraftsForProperty(tx, {
          organizationId: ORG,
          propertyId: seeded.property,
        }),
      )

      const submitted = await submitForApproval(readBySubmit, seeded.property, new Date())

      expect(submitted).toBeNull()
      expect(await replyRows(seeded.review.id)).toEqual([WITHDRAWN])
    })

    it('tells the people waiting on it when it had been submitted again', async () => {
      const seeded = await seedCancelledAiReply()
      const now = new Date()
      const resubmitted = await submitForApproval(
        await storedReply(seeded),
        seeded.property,
        now,
      )
      expect(resubmitted).toMatchObject({ status: 'pending_approval' })

      await db.transaction((tx) =>
        purgeAiDraftsForProperty(tx, {
          organizationId: ORG,
          propertyId: seeded.property,
        }),
      )

      expect(await replyRows(seeded.review.id)).toEqual([WITHDRAWN])
      expect(await cancellationFacts()).toEqual([
        withdrawalFact(seeded),
        policyFact(seeded),
      ])
    })
  })

  describe('replies the purge must leave alone', () => {
    it('keeps a reply the manager edited, another Property and a dispatched reply', async () => {
      const edited = await seedAiReply('draft')
      const elsewhere = await seedAiReply('draft')
      const dispatched = await seedAiReply('authorized', edited.property)
      // A draft save is a manager writing the text: the store records the
      // reply as human-authored.
      const typedOver = await replyRepository.saveDraft(
        edited.reply,
        { text: 'Rewritten by a manager' },
        new Date(),
      )
      if (!typedOver) throw new Error('The AI-assisted draft could not be typed over')
      await db.execute(sql`
        UPDATE replies SET publication_state = 'sending'
        WHERE id = ${dispatched.reply.id}::uuid AND organization_id = ${ORG}
      `)

      await db.transaction((tx) =>
        purgeAiDraftsForProperty(tx, {
          organizationId: ORG,
          propertyId: edited.property,
        }),
      )

      expect(await replyRows(edited.review.id)).toMatchObject([
        { status: 'draft', text: 'Rewritten by a manager', authorship: 'human' },
      ])
      expect(await replyRows(elsewhere.review.id)).toMatchObject([
        { status: 'draft', text: SUGGESTION, authorship: 'ai_assisted' },
      ])
      expect(await replyRows(dispatched.review.id)).toMatchObject([
        {
          status: 'approved',
          publication_state: 'sending',
          text: SUGGESTION,
          authorship: 'ai_assisted',
        },
      ])
      expect(await cancellationFacts()).toEqual([])
    })
  })
})
