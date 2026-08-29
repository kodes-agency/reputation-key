import type { ReviewRepository } from '../ports/review.repository'
import type { ReviewId } from '#/shared/domain/ids'
import { defaultReviewLifecycle, type Review } from '../../domain/types'
import { reviewCreated, reviewUpdated } from '../../domain/events'
import { calculateExpiresAt, computeReviewContentHash } from '../../domain/rules'
import type { ReviewCommandStore } from '../ports/review-command-store.port'
import type { ReviewProviderObservationWriter } from '../ports/review-provider-snapshot.repository'
import type { GoogleReplyObservationStore } from '../ports/google-reply-observation-store.port'
import { computeAiReviewSourceProvenance } from '../ai-review-source'
import { contentExpiresAtFromFetch } from '#/shared/domain/source-content-policy'
import { sha256Hex } from '#/shared/domain/sha256'

export type ReviewProviderObservationWriterDeps = Readonly<{
  reviewRepo: ReviewRepository
  clock: () => Date
  idGen: () => ReviewId
  commandStore: ReviewCommandStore
  googleReplyObservationStore: GoogleReplyObservationStore
}>

export function providerReplyObservationKey(
  input: Readonly<{
    providerObservationKey: string
    sourceEpoch: number
    materialReviewRevision: number
    replyUpdatedAt: Date | null
    replyText: string | null
  }>,
): string {
  const replyIdentity =
    input.replyText === null
      ? 'reply-state:absent'
      : `reply-state:live:${sha256Hex(input.replyText)}`
  return sha256Hex(
    [
      'provider-reply-observation-v1',
      input.providerObservationKey,
      String(input.sourceEpoch),
      String(input.materialReviewRevision),
      input.replyUpdatedAt?.toISOString() ?? 'none',
      replyIdentity,
    ].join('\0'),
  )
}

/**
 * Request-scoped Google observation writer used by the provider snapshot
 * orchestrator. It performs no provider I/O and never logs a provider resource.
 * A rejected write throws so the enclosing snapshot page remains
 * non-authoritative; a later page replay safely repeats the idempotent write.
 */
export const createReviewProviderObservationWriter = (
  deps: ReviewProviderObservationWriterDeps,
): ReviewProviderObservationWriter => ({
  allocateReplyReadGeneration: () =>
    deps.googleReplyObservationStore.allocateReadGeneration(),
  persist: async (input) => {
    const now = deps.clock()
    const existing = await deps.reviewRepo.findByExternalId(
      'google',
      input.review.externalId,
      input.organizationId,
    )
    const stableIdentity = await deps.reviewRepo.findStableIdentityByProviderSubjects({
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      sourceEpoch: input.sourceEpoch,
      subjects: input.subjects,
    })
    assertObservationScope(existing, stableIdentity, input)

    const review = buildObservedReview({
      input,
      now,
      existing,
      stableIdentity,
      newId: () => deps.idGen(),
    })
    const persisted = await persistObservation(deps, review, now, {
      ...classifyObservation(existing, stableIdentity, review, now),
      observationKey: input.observationKey,
      observationOrigin: input.observationOrigin,
    })
    await deps.googleReplyObservationStore.record({
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      reviewId: persisted.id,
      sourceEpoch: persisted.sourceEpoch,
      materialReviewRevision: persisted.sourceRevision,
      readGeneration: input.replyReadGeneration,
      observationKey: providerReplyObservationKey({
        providerObservationKey: input.observationKey,
        sourceEpoch: persisted.sourceEpoch,
        materialReviewRevision: persisted.sourceRevision,
        replyUpdatedAt: input.review.replyUpdatedAt,
        replyText: input.review.replyText,
      }),
      source: 'provider_snapshot',
      observedText: input.review.replyText,
      providerUpdatedAt: input.review.replyUpdatedAt,
      observedAt: now,
      contentExpiresAt: persisted.contentExpiresAt ?? contentExpiresAtFromFetch(now),
    })
    return {
      reviewId: persisted.id,
      sourceRevision: persisted.sourceRevision,
      // `existing == null` is the new-vs-seen decision; the snapshot
      // orchestrator turns it into the discovery ladder's activity stamp.
      isNew: existing == null && stableIdentity == null,
    }
  },
})

type ProviderObservationInput = Parameters<ReviewProviderObservationWriter['persist']>[0]
type StableIdentity = Awaited<
  ReturnType<ReviewRepository['findStableIdentityByProviderSubjects']>
>

/** The provider observation may only advance the Review it names. A row found by
 * external id or by stable provider subject that sits in another property,
 * organization, source epoch, or identity is not this observation's subject. */
function assertObservationScope(
  existing: Review | null,
  stableIdentity: StableIdentity,
  scope: Readonly<{
    organizationId: ProviderObservationInput['organizationId']
    propertyId: ProviderObservationInput['propertyId']
    sourceEpoch: number
  }>,
): void {
  if (
    existing != null &&
    (existing.propertyId !== scope.propertyId ||
      existing.sourceEpoch !== scope.sourceEpoch)
  ) {
    throw new Error('Review provider observation scope mismatch')
  }
  if (
    stableIdentity != null &&
    (stableIdentity.propertyId !== scope.propertyId ||
      stableIdentity.organizationId !== scope.organizationId ||
      stableIdentity.sourceEpoch !== scope.sourceEpoch ||
      (existing != null && existing.id !== stableIdentity.id))
  ) {
    throw new Error('Review provider subject identity mismatch')
  }
}

/** Source lifecycle for the observed Review. A known row keeps its own
 * lifecycle; a row reached only through its stable provider subject keeps that
 * subject's source counters; anything else starts a fresh lifecycle. */
function resolveObservedLifecycle(
  args: Readonly<{
    input: ProviderObservationInput
    now: Date
    existing: Review | null
    stableIdentity: StableIdentity
    contentHash: string
    provenance: Readonly<{ byteLength: number; digest: string }>
  }>,
) {
  const { input, now, existing, stableIdentity, contentHash, provenance } = args
  if (existing != null) {
    return defaultReviewLifecycle({
      reviewedAt: input.review.reviewedAt,
      now,
      contentHash,
      sourceEpoch: input.sourceEpoch,
      existing,
      aiSourceByteLength: provenance.byteLength,
      aiSourceDigest: provenance.digest,
    })
  }
  if (stableIdentity != null) {
    return {
      sourceCreatedAt: input.review.reviewedAt,
      sourceUpdatedAt: null,
      firstFetchedAt: stableIdentity.firstFetchedAt ?? now,
      lastFetchedAt: now,
      contentExpiresAt: contentExpiresAtFromFetch(now),
      contentHash,
      sourceSeenGeneration: stableIdentity.sourceSeenGeneration,
      sourceEpoch: stableIdentity.sourceEpoch,
      sourceRevision: stableIdentity.sourceRevision,
      analysisSequence: stableIdentity.analysisSequence,
      aiSourceByteLength: provenance.byteLength,
      aiSourceDigest: provenance.digest,
    }
  }
  return defaultReviewLifecycle({
    reviewedAt: input.review.reviewedAt,
    now,
    contentHash,
    sourceEpoch: input.sourceEpoch,
    existing: null,
    aiSourceByteLength: provenance.byteLength,
    aiSourceDigest: provenance.digest,
  })
}

/** The Review row this observation writes: provider content plus the resolved
 * lifecycle, reusing the known identity and derived sentiment when there is one. */
function buildObservedReview(
  args: Readonly<{
    input: ProviderObservationInput
    now: Date
    existing: Review | null
    stableIdentity: StableIdentity
    newId: () => ReviewId
  }>,
): Omit<Review, 'createdAt' | 'updatedAt'> {
  const { input, now, existing, stableIdentity } = args
  const contentHash = computeReviewContentHash({
    rating: input.review.rating,
    text: input.review.text,
    reviewerName: input.review.reviewerName,
    languageCode: input.review.languageCode,
  })
  const provenance = computeAiReviewSourceProvenance({
    text: input.review.text,
    rating: input.review.rating,
    languageCode: input.review.languageCode,
    reviewedAtEpochMillis: input.review.reviewedAt.getTime(),
    reviewerDisplayName: input.review.reviewerName,
  })
  const lifecycle = resolveObservedLifecycle({
    input,
    now,
    existing,
    stableIdentity,
    contentHash,
    provenance,
  })
  return {
    id: existing?.id ?? stableIdentity?.id ?? args.newId(),
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    platform: 'google',
    externalId: input.review.externalId,
    externalLocationId: input.review.externalLocationId,
    googleConnectionId: input.connectionId,
    reviewerName: input.review.reviewerName,
    reviewerProfilePhotoUrl: input.review.reviewerProfilePhotoUrl,
    rating: input.review.rating,
    text: input.review.text,
    translatedText: input.review.translatedText,
    languageCode: input.review.languageCode,
    reviewedAt: input.review.reviewedAt,
    expiresAt: calculateExpiresAt(input.review.reviewedAt, now),
    sentimentLabel: existing?.sentimentLabel ?? stableIdentity?.sentimentLabel ?? null,
    sentimentScore: existing?.sentimentScore ?? stableIdentity?.sentimentScore ?? null,
    ...lifecycle,
    sourceCreatedAt: input.review.sourceCreatedAt ?? lifecycle.sourceCreatedAt,
    sourceUpdatedAt: input.review.sourceUpdatedAt ?? lifecycle.sourceUpdatedAt,
  }
}

/** Which write path this observation takes: a first sighting, a re-observation
 * of expired source content, or an unchanged body that needs no new revision. */
function classifyObservation(
  existing: Review | null,
  stableIdentity: StableIdentity,
  review: Omit<Review, 'createdAt' | 'updatedAt'>,
  now: Date,
): Readonly<{ isNew: boolean; expired: boolean; contentUnchanged: boolean }> {
  const expired =
    (stableIdentity != null && stableIdentity.sourceContentState !== 'active') ||
    (existing?.contentExpiresAt != null &&
      existing.contentExpiresAt.getTime() <= now.getTime())
  return {
    isNew: existing == null && stableIdentity == null,
    expired,
    contentUnchanged:
      existing != null && !expired && existing.aiSourceDigest === review.aiSourceDigest,
  }
}

async function persistObservation(
  deps: ReviewProviderObservationWriterDeps,
  review: Omit<Review, 'createdAt' | 'updatedAt'>,
  now: Date,
  state: Readonly<{
    isNew: boolean
    contentUnchanged: boolean
    expired: boolean
    observationKey: string
    observationOrigin: Parameters<ReviewCommandStore['upsertAndRecord']>[4]
  }>,
): Promise<Review> {
  if (state.expired) {
    return deps.commandStore.reobserveExpiredAndRecord(
      review,
      now,
      state.observationKey,
      state.observationOrigin,
    )
  }
  if (state.contentUnchanged) {
    return deps.reviewRepo.upsert(
      review,
      now,
      state.observationKey,
      state.observationOrigin,
    )
  }
  const eventForReview = (persisted: Review) => {
    const payload = {
      reviewId: persisted.id,
      propertyId: persisted.propertyId,
      organizationId: persisted.organizationId,
      platform: 'google' as const,
      sourceEpoch: persisted.sourceEpoch,
      sourceRevision: persisted.sourceRevision,
      analysisSequence: persisted.analysisSequence,
      occurredAt: now,
    }
    return state.isNew ? reviewCreated(payload) : reviewUpdated(payload)
  }
  return deps.commandStore.upsertAndRecord(
    review,
    eventForReview,
    now,
    state.observationKey,
    state.observationOrigin,
  )
}
