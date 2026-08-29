import { and, asc, eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { materialReviewRevisions, reviews } from '#/shared/db/schema/review.schema'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import type { Tx } from '#/shared/outbox/commit'
import type {
  ReviewCurrentResponseTargetPermit,
  ReviewCurrentInboxProjectionPermit,
  ReviewInboxProjectionExpectation,
  ReviewInboxProjectionRevisionPermit,
  ReviewResponseTargetAuthority,
  ReviewResponseTargetEligibility,
  ReviewResponseTargetExpectation,
} from '../application/ports/response-target-authority.port'
import { runWithReviewExactCurrentApplyAdmission } from './exact-current-apply-admission'
import { lockReviewSourceMutationScope } from './review-source-mutation-serialization'

const ELIGIBILITY = new Set<ReviewResponseTargetEligibility>([
  'measured',
  'historical_onboarding',
  'legacy_unknown',
])

async function readCurrentPermit(
  tx: Tx,
  expectation: ReviewResponseTargetExpectation,
): Promise<ReviewCurrentResponseTargetPermit | null> {
  const scopeCurrent = await lockReviewSourceMutationScope(tx, {
    organizationId: organizationId(expectation.organizationId),
    propertyId: propertyId(expectation.propertyId),
    reviewId: reviewId(expectation.reviewId),
    sourceEpoch: expectation.sourceEpoch,
  })
  if (!scopeCurrent) return null

  const rows = await tx
    .select({
      organizationId: reviews.organizationId,
      propertyId: reviews.propertyId,
      reviewId: reviews.id,
      sourceEpoch: reviews.sourceEpoch,
      materialReviewRevision: reviews.sourceRevision,
      sourceContentState: reviews.sourceContentState,
      eligibility: materialReviewRevisions.responseTargetEligibility,
      responseTargetStartAt: materialReviewRevisions.responseTargetStartAt,
    })
    .from(reviews)
    .innerJoin(
      materialReviewRevisions,
      and(
        eq(materialReviewRevisions.reviewId, reviews.id),
        eq(materialReviewRevisions.organizationId, reviews.organizationId),
        eq(materialReviewRevisions.propertyId, reviews.propertyId),
        eq(materialReviewRevisions.sourceEpoch, reviews.sourceEpoch),
        eq(materialReviewRevisions.revision, reviews.sourceRevision),
      ),
    )
    .where(
      and(
        eq(reviews.id, expectation.reviewId),
        eq(reviews.organizationId, expectation.organizationId),
        eq(reviews.propertyId, expectation.propertyId),
        eq(reviews.sourceEpoch, expectation.sourceEpoch),
      ),
    )
    .for('update', { of: reviews })
    .limit(1)
  const current = rows[0]
  if (
    current === undefined ||
    current.sourceContentState !== 'active' ||
    !ELIGIBILITY.has(current.eligibility as ReviewResponseTargetEligibility)
  ) {
    return null
  }
  const eligibility = current.eligibility as ReviewResponseTargetEligibility
  if ((eligibility === 'measured') !== current.responseTargetStartAt instanceof Date) {
    return null
  }
  return {
    authority: 'review.current-response-target.v1',
    organizationId: current.organizationId,
    propertyId: current.propertyId,
    reviewId: current.reviewId,
    sourceEpoch: current.sourceEpoch,
    materialReviewRevision: current.materialReviewRevision,
    eligibility,
    responseTargetStartAt: current.responseTargetStartAt,
  }
}

function selectInboxProjectionReviewRow(
  tx: Tx,
  expectation: ReviewInboxProjectionExpectation,
) {
  return tx
    .select({
      organizationId: reviews.organizationId,
      propertyId: reviews.propertyId,
      reviewId: reviews.id,
      platform: reviews.platform,
      sourceEpoch: reviews.sourceEpoch,
      sourceRevision: reviews.sourceRevision,
      sourceContentState: reviews.sourceContentState,
      sourceContentErasedAt: reviews.sourceContentErasedAt,
      reviewedAt: reviews.reviewedAt,
    })
    .from(reviews)
    .where(
      and(
        eq(reviews.id, expectation.reviewId),
        eq(reviews.organizationId, expectation.organizationId),
        eq(reviews.propertyId, expectation.propertyId),
        eq(reviews.sourceEpoch, expectation.sourceEpoch),
      ),
    )
    .for('update', { of: reviews })
    .limit(1)
}

function selectMaterialRevisionRows(
  tx: Tx,
  expectation: ReviewInboxProjectionExpectation,
) {
  return tx
    .select({
      organizationId: materialReviewRevisions.organizationId,
      propertyId: materialReviewRevisions.propertyId,
      reviewId: materialReviewRevisions.reviewId,
      sourceEpoch: materialReviewRevisions.sourceEpoch,
      revision: materialReviewRevisions.revision,
      eligibility: materialReviewRevisions.responseTargetEligibility,
      responseTargetStartAt: materialReviewRevisions.responseTargetStartAt,
      observedAt: materialReviewRevisions.createdAt,
    })
    .from(materialReviewRevisions)
    .where(
      and(
        eq(materialReviewRevisions.organizationId, expectation.organizationId),
        eq(materialReviewRevisions.propertyId, expectation.propertyId),
        eq(materialReviewRevisions.reviewId, expectation.reviewId),
        eq(materialReviewRevisions.sourceEpoch, expectation.sourceEpoch),
      ),
    )
    .orderBy(asc(materialReviewRevisions.revision))
}

type InboxProjectionReviewRow = Awaited<
  ReturnType<typeof selectInboxProjectionReviewRow>
>[number]
type MaterialRevisionRow = Awaited<ReturnType<typeof selectMaterialRevisionRows>>[number]

type ProjectableReviewRow = InboxProjectionReviewRow &
  Readonly<{
    platform: 'google'
    sourceContentState: 'active' | 'source_expired' | 'provider_deleted'
  }>

/** Only a Google Review whose source has already reached the event's revision
 * and whose content state is one Inbox can project may be read at all. */
function isProjectableReviewRow(
  current: InboxProjectionReviewRow,
  expectation: ReviewInboxProjectionExpectation,
): current is ProjectableReviewRow {
  return (
    current.platform === 'google' &&
    current.sourceRevision >= expectation.eventSourceRevision &&
    (current.sourceContentState === 'active' ||
      current.sourceContentState === 'source_expired' ||
      current.sourceContentState === 'provider_deleted')
  )
}

type MaterialRevisionChain = Readonly<{
  revisions: ReviewInboxProjectionRevisionPermit[]
  /** Observation time of the newest revision in the chain. */
  latestObservedAt: number
}>

/**
 * The Material Revision history must be a gapless 1..N sequence with
 * non-decreasing observation times and eligibility evidence that agrees with
 * its response-target start. Any deviation makes the projection unsafe, which
 * is reported as no chain at all.
 */
function buildMaterialRevisionChain(
  rows: readonly MaterialRevisionRow[],
): MaterialRevisionChain | null {
  if (rows.length === 0) return null
  const revisions: ReviewInboxProjectionRevisionPermit[] = []
  let previousObservedAt = Number.NEGATIVE_INFINITY
  for (const [index, row] of rows.entries()) {
    const eligibility = row.eligibility as ReviewResponseTargetEligibility
    if (
      !ELIGIBILITY.has(eligibility) ||
      (eligibility === 'measured') !== row.responseTargetStartAt instanceof Date ||
      !(row.observedAt instanceof Date) ||
      !Number.isFinite(row.observedAt.getTime()) ||
      row.observedAt.getTime() < previousObservedAt ||
      (row.responseTargetStartAt instanceof Date &&
        !Number.isFinite(row.responseTargetStartAt.getTime())) ||
      row.revision !== index + 1
    ) {
      return null
    }
    revisions.push({
      authority: 'review.inbox-projection-revision.v1',
      organizationId: row.organizationId,
      propertyId: row.propertyId,
      reviewId: row.reviewId,
      sourceEpoch: row.sourceEpoch,
      materialReviewRevision: row.revision,
      eligibility,
      responseTargetStartAt: row.responseTargetStartAt,
      observedAt: row.observedAt,
    })
    previousObservedAt = row.observedAt.getTime()
  }
  return { revisions, latestObservedAt: previousObservedAt }
}

/** The chain must end at the Review's current revision and contain the event's
 * own revision; a `created` event must additionally name the first revision. */
function chainCoversExpectation(
  revisions: readonly ReviewInboxProjectionRevisionPermit[],
  first: ReviewInboxProjectionRevisionPermit,
  last: ReviewInboxProjectionRevisionPermit,
  currentSourceRevision: number,
  expectation: ReviewInboxProjectionExpectation,
): boolean {
  return (
    last.materialReviewRevision === currentSourceRevision &&
    revisions.some(
      (revision) => revision.materialReviewRevision === expectation.eventSourceRevision,
    ) &&
    (expectation.eventKind !== 'created' ||
      expectation.eventSourceRevision === first.materialReviewRevision)
  )
}

/** Active content carries a reviewed timestamp and no erasure; erased content
 * carries a finite erasure timestamp that is not older than the newest observed
 * revision. */
function hasConsistentContentState(
  current: InboxProjectionReviewRow,
  latestObservedAt: number,
): boolean {
  const active = current.sourceContentState === 'active'
  if (active && !(current.reviewedAt instanceof Date)) return false
  if (active && current.sourceContentErasedAt !== null) return false
  if (!active && !(current.sourceContentErasedAt instanceof Date)) return false
  if (current.sourceContentErasedAt instanceof Date) {
    return (
      Number.isFinite(current.sourceContentErasedAt.getTime()) &&
      current.sourceContentErasedAt.getTime() >= latestObservedAt
    )
  }
  return true
}

async function readInboxProjectionPermit(
  tx: Tx,
  expectation: ReviewInboxProjectionExpectation,
): Promise<ReviewCurrentInboxProjectionPermit | null> {
  if (
    !Number.isSafeInteger(expectation.eventSourceRevision) ||
    expectation.eventSourceRevision < 1
  ) {
    return null
  }
  const scopeCurrent = await lockReviewSourceMutationScope(tx, {
    organizationId: organizationId(expectation.organizationId),
    propertyId: propertyId(expectation.propertyId),
    reviewId: reviewId(expectation.reviewId),
    sourceEpoch: expectation.sourceEpoch,
  })
  if (!scopeCurrent) return null

  const [current] = await selectInboxProjectionReviewRow(tx, expectation)
  if (current === undefined) return null
  if (!isProjectableReviewRow(current, expectation)) return null

  const chain = buildMaterialRevisionChain(
    await selectMaterialRevisionRows(tx, expectation),
  )
  if (chain === null) return null
  const revisions = chain.revisions
  const first = revisions[0]
  const last = revisions.at(-1)
  if (first === undefined || last === undefined) return null
  if (
    !chainCoversExpectation(revisions, first, last, current.sourceRevision, expectation)
  ) {
    return null
  }
  if (!hasConsistentContentState(current, chain.latestObservedAt)) return null

  const sourceDate = current.reviewedAt ?? first.responseTargetStartAt ?? first.observedAt
  if (!Number.isFinite(sourceDate.getTime())) return null
  return {
    authority: 'review.current-inbox-projection.v1',
    organizationId: current.organizationId,
    propertyId: current.propertyId,
    reviewId: current.reviewId,
    sourceEpoch: current.sourceEpoch,
    platform: current.platform,
    sourceDate,
    sourceContentState: current.sourceContentState,
    sourceContentErasedAt: current.sourceContentErasedAt,
    currentMaterialReviewRevision: current.sourceRevision,
    revisions: revisions as [
      ReviewInboxProjectionRevisionPermit,
      ...ReviewInboxProjectionRevisionPermit[],
    ],
  }
}

/**
 * Review-owned current Material Revision authority for Inbox target creation.
 * The Review source fence remains held until Inbox commits its own immutable
 * cycle/target snapshot, so the durable event acts only as a wake-up hint.
 */
export const createReviewResponseTargetAuthority = (
  db: Database,
): ReviewResponseTargetAuthority => ({
  withExactCurrent: async <T>(
    expectation: ReviewResponseTargetExpectation,
    apply: (permit: ReviewCurrentResponseTargetPermit) => Promise<T>,
  ) =>
    runWithReviewExactCurrentApplyAdmission(() =>
      db.transaction(async (tx) => {
        const permit = await readCurrentPermit(tx, expectation)
        if (!permit) return { status: 'obsolete' as const }
        return {
          status: 'current' as const,
          value: await apply(permit),
        }
      }),
    ),
  withExactCurrentBatch: async <T>(
    expectations: readonly ReviewResponseTargetExpectation[],
    apply: (permits: readonly ReviewCurrentResponseTargetPermit[]) => Promise<T>,
  ) => {
    if (expectations.length < 1 || expectations.length > 100) {
      throw new TypeError(
        'Review Response Target authority batch must contain 1–100 items',
      )
    }
    const ordered = [...expectations].sort((left, right) => {
      const leftKey = `${left.organizationId}\0${left.propertyId}\0${left.reviewId}`
      const rightKey = `${right.organizationId}\0${right.propertyId}\0${right.reviewId}`
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
    })
    if (new Set(ordered.map((entry) => entry.reviewId)).size !== ordered.length) {
      throw new TypeError('Review Response Target authority batch contains duplicates')
    }
    return runWithReviewExactCurrentApplyAdmission(() =>
      db.transaction(async (tx) => {
        const permits: ReviewCurrentResponseTargetPermit[] = []
        for (const expectation of ordered) {
          const permit = await readCurrentPermit(tx, expectation)
          if (!permit) return { status: 'obsolete' as const }
          permits.push(permit)
        }
        return { status: 'current' as const, value: await apply(permits) }
      }),
    )
  },
  withInboxProjection: async <T>(
    expectation: ReviewInboxProjectionExpectation,
    apply: (permit: ReviewCurrentInboxProjectionPermit) => Promise<T>,
  ) =>
    runWithReviewExactCurrentApplyAdmission(() =>
      db.transaction(async (tx) => {
        const permit = await readInboxProjectionPermit(tx, expectation)
        if (!permit) return { status: 'obsolete' as const }
        return {
          status: 'current' as const,
          value: await apply(permit),
        }
      }),
    ),
})
