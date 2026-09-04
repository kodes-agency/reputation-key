import { timingSafeEqual } from 'node:crypto'
import { and, asc, eq, gt, inArray, lte, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type { EventBus } from '#/shared/events/event-bus'
import type { DomainEvent } from '#/shared/events/events'
import type { Tx } from '#/shared/outbox/commit'
import { emitAfterCommit, insertOutboxRow } from '#/shared/outbox/commit'
import {
  reviewProviderDeletionCandidates,
  reviewGoogleReputationSnapshotFacts,
  reviewProviderSnapshotMembers,
  reviewProviderSnapshotRuns,
  reviewProviderSubjectHmacKeyVersions,
  reviewProviderSubjects,
  reviews,
} from '#/shared/db/schema/review.schema'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import type {
  ReviewProviderPersistedObservation,
  ReviewProviderSnapshotFailureCode,
  ReviewProviderSnapshotRepository,
  ReviewProviderSnapshotRun,
} from '../../application/ports/review-provider-snapshot.repository'
import {
  reviewGoogleReputationSnapshotVerified,
  reviewSourceTransitioned,
} from '../../domain/events'
import { domainError } from '#/shared/domain/errors'
import { eraseReviewSourceContent } from '../review-source-content-store'
import { lockReviewSourceMutationScope } from '../review-source-mutation-serialization'
import { createReviewSourceContentLifecycleStore } from './source-content-lifecycle-store.repository'
import {
  REVIEW_SOURCE_CONTENT_LIFECYCLE_CONTRACT,
  createRunReviewSourceContentLifecycle,
} from '../../application/use-cases/run-source-content-lifecycle'

const ACTIVE_STATES = ['scanning', 'confirming', 'deleting'] as const
const TERMINAL_RECORD_RETENTION = sql`interval '30 days'`

type RunRow = typeof reviewProviderSnapshotRuns.$inferSelect
type SubjectRow = typeof reviewProviderSubjects.$inferSelect

function fromRunRow(row: RunRow): ReviewProviderSnapshotRun {
  return {
    id: row.id,
    organizationId: organizationId(row.organizationId),
    propertyId: propertyId(row.propertyId),
    sourceEpoch: row.sourceEpoch,
    observationOrigin:
      row.observationOrigin as ReviewProviderSnapshotRun['observationOrigin'],
    state: row.state as ReviewProviderSnapshotRun['state'],
    phase: row.phase as ReviewProviderSnapshotRun['phase'],
    startedAt: row.startedAt,
    expectedProviderTotal: row.expectedTotal,
    expectedProviderAverageRating: row.expectedAverageRating,
    mainPageIndex: row.mainPageCount,
    mainCursorRef: row.mainCursorRef,
    mainUniqueCount: row.mainUniqueCount,
    confirmationPageIndex: row.confirmationPageCount,
    confirmationCursorRef: row.confirmationCursorRef,
    confirmationUniqueCount: row.confirmationUniqueCount,
    confirmationDeadline: row.confirmationDeadline,
    applyCursorReviewId:
      row.applyCursorReviewId == null ? null : reviewId(row.applyCursorReviewId),
    terminalAt: row.terminalAt,
    failureCode: row.failureCode as ReviewProviderSnapshotFailureCode | null,
  }
}

function hmacEquals(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === 32 &&
    right.byteLength === 32 &&
    timingSafeEqual(Buffer.from(left), Buffer.from(right))
  )
}

function failCode(error: unknown): ReviewProviderSnapshotFailureCode {
  if (error instanceof SnapshotConflict) return error.code
  return 'resource_collision'
}

class SnapshotConflict extends Error {
  readonly code: ReviewProviderSnapshotFailureCode

  constructor(code: ReviewProviderSnapshotFailureCode) {
    super(code)
    this.code = code
  }
}

const providerAggregateIsValid = (
  total: number | null,
  averageRating: number | null,
): boolean =>
  (total === 0 && averageRating === null) ||
  (total !== null &&
    total > 0 &&
    total <= 10_000 &&
    averageRating !== null &&
    Number.isFinite(averageRating) &&
    averageRating >= 0 &&
    averageRating <= 5)

async function failLockedRun(
  tx: Tx,
  row: RunRow,
  code: ReviewProviderSnapshotFailureCode,
): Promise<RunRow> {
  if (row.state === 'completed' || row.state === 'failed') return row
  const terminal = await tx
    .update(reviewProviderSnapshotRuns)
    .set({
      state: 'failed',
      phase: 'terminal',
      failureCode: code,
      terminalAt: sql`transaction_timestamp()`,
      recordExpiresAt: sql`transaction_timestamp() + ${TERMINAL_RECORD_RETENTION}`,
      mainCursorRef: null,
      confirmationCursorRef: null,
      updatedAt: sql`transaction_timestamp()`,
    })
    .where(
      and(
        eq(reviewProviderSnapshotRuns.id, row.id),
        eq(reviewProviderSnapshotRuns.organizationId, row.organizationId),
      ),
    )
    .returning()
  if (!terminal[0])
    throw domainError(
      'snapshot_run_missing_on_fail',
      'Snapshot run disappeared while failing',
    )
  return terminal[0]
}

type PageCommitInput = Parameters<ReviewProviderSnapshotRepository['commitPage']>[0]
type DeletionCandidateRow = typeof reviewProviderDeletionCandidates.$inferSelect

function selectLockedDeletionReviews(tx: Tx, reviewIds: ReadonlyArray<string>) {
  return tx
    .select({
      id: reviews.id,
      organizationId: reviews.organizationId,
      propertyId: reviews.propertyId,
      sourceEpoch: reviews.sourceEpoch,
      sourceRevision: reviews.sourceRevision,
    })
    .from(reviews)
    .where(inArray(reviews.id, [...reviewIds]))
    .orderBy(asc(reviews.id))
    .for('update')
}

type LockedDeletionReview = Awaited<
  ReturnType<typeof selectLockedDeletionReviews>
>[number]

/** The candidate is no longer provably deletable: keep it as observed evidence
 * and leave the Review untouched. */
async function markDeletionCandidateObserved(
  tx: Tx,
  runId: string,
  reviewId: string,
): Promise<void> {
  await tx
    .update(reviewProviderDeletionCandidates)
    .set({ state: 'observed', updatedAt: sql`transaction_timestamp()` })
    .where(
      and(
        eq(reviewProviderDeletionCandidates.runId, runId),
        eq(reviewProviderDeletionCandidates.reviewId, reviewId),
      ),
    )
}

type DeletionCandidateOutcome =
  Readonly<{ kind: 'observed' }> | Readonly<{ kind: 'applied'; event: DomainEvent }>

const DELETION_OBSERVED: DeletionCandidateOutcome = { kind: 'observed' }

/**
 * Redact one confirmed-missing Review. The locked Review row, the provider
 * subject mapping, and the erasure itself must all still match the evidence the
 * candidate was recorded with; any mismatch downgrades the candidate to
 * observed rather than deleting content on stale grounds.
 */
async function applyDeletionCandidate(
  tx: Tx,
  run: RunRow,
  candidate: DeletionCandidateRow,
  lockedReview: LockedDeletionReview | undefined,
): Promise<DeletionCandidateOutcome> {
  if (
    lockedReview == null ||
    lockedReview.organizationId !== run.organizationId ||
    lockedReview.propertyId !== run.propertyId ||
    lockedReview.sourceEpoch !== run.sourceEpoch ||
    lockedReview.sourceRevision !== candidate.expectedSourceRevision
  ) {
    await markDeletionCandidateObserved(tx, run.id, candidate.reviewId)
    return DELETION_OBSERVED
  }
  const mappings = await tx
    .select()
    .from(reviewProviderSubjects)
    .where(
      and(
        eq(reviewProviderSubjects.organizationId, run.organizationId),
        eq(reviewProviderSubjects.propertyId, run.propertyId),
        eq(reviewProviderSubjects.sourceEpoch, run.sourceEpoch),
        eq(reviewProviderSubjects.reviewId, candidate.reviewId),
      ),
    )
    .for('update')
  const mapping = mappings[0]
  if (
    mapping == null ||
    mapping.state !== candidate.expectedMappingState ||
    mapping.lastSourceRevision !== candidate.expectedSourceRevision ||
    mapping.firstMissingSnapshotRunId == null ||
    mapping.lastSeenSnapshotRunId === run.id
  ) {
    await markDeletionCandidateObserved(tx, run.id, candidate.reviewId)
    return DELETION_OBSERVED
  }
  const erased = await eraseReviewSourceContent(tx, {
    reviewId: reviewId(candidate.reviewId),
    organizationId: organizationId(run.organizationId),
    propertyId: propertyId(run.propertyId),
    sourceEpoch: run.sourceEpoch,
    expectedSourceRevision: candidate.expectedSourceRevision,
    state: 'provider_deleted',
  })
  if (!erased) {
    await markDeletionCandidateObserved(tx, run.id, candidate.reviewId)
    return DELETION_OBSERVED
  }
  const event = await recordSourceTransition(tx, mapping, 'provider_deleted')
  await tx
    .update(reviewProviderSubjects)
    .set({
      state: 'provider_deleted',
      unlinkedAt: mapping.unlinkedAt ?? sql`transaction_timestamp()`,
      unlinkExpiresAt:
        mapping.unlinkExpiresAt ?? sql`transaction_timestamp() + interval '24 months'`,
      updatedAt: sql`transaction_timestamp()`,
    })
    .where(
      and(
        eq(reviewProviderSubjects.organizationId, mapping.organizationId),
        eq(reviewProviderSubjects.propertyId, mapping.propertyId),
        eq(reviewProviderSubjects.sourceEpoch, mapping.sourceEpoch),
        eq(reviewProviderSubjects.keyVersion, mapping.keyVersion),
        eq(reviewProviderSubjects.locatorHmac, mapping.locatorHmac),
      ),
    )
  return { kind: 'applied', event }
}

/** The completed run publishes the verified provider aggregate exactly once,
 * durably, at the database's own transaction instant. */
async function recordVerifiedSnapshotFact(tx: Tx, run: RunRow): Promise<DomainEvent> {
  if (
    run.expectedTotal == null ||
    !providerAggregateIsValid(run.expectedTotal, run.expectedAverageRating)
  ) {
    throw domainError(
      'provider_aggregate_unavailable',
      'Verified provider aggregate is unavailable at completion',
    )
  }
  const evaluatedRows = await tx.execute(
    sql`SELECT transaction_timestamp() AS evaluated_at`,
  )
  const evaluatedValue = (evaluatedRows.rows[0] as { evaluated_at: Date | string })
    .evaluated_at
  const evaluatedAt =
    evaluatedValue instanceof Date ? evaluatedValue : new Date(evaluatedValue)
  const verified = reviewGoogleReputationSnapshotVerified({
    organizationId: organizationId(run.organizationId),
    propertyId: propertyId(run.propertyId),
    sourceEpoch: run.sourceEpoch,
    runId: run.id,
    reviewCount: run.expectedTotal,
    averageRating: run.expectedAverageRating,
    evaluatedAt,
    occurredAt: evaluatedAt,
  })
  await tx.insert(reviewGoogleReputationSnapshotFacts).values({
    runId: run.id,
    eventId: verified.eventId,
    organizationId: run.organizationId,
    propertyId: run.propertyId,
    sourceEpoch: run.sourceEpoch,
    reviewCount: run.expectedTotal,
    averageRating: run.expectedAverageRating,
    evaluatedAt,
  })
  await insertOutboxRow(tx, verified, { recordedAt: evaluatedAt })
  return verified
}

/**
 * The first conflict this page trips, in the order the failure taxonomy ranks
 * them: a changed provider aggregate outranks a malformed one, which outranks a
 * blown review cap, which outranks a blown page cap. Null means the page is
 * acceptable.
 */
function pageCommitConflictCode(
  run: RunRow,
  input: PageCommitInput,
): ReviewProviderSnapshotFailureCode | null {
  if (run.expectedTotal != null && run.expectedTotal !== input.totalReviewCount) {
    return 'total_changed'
  }
  if (run.expectedTotal != null && run.expectedAverageRating !== input.averageRating) {
    return 'average_changed'
  }
  if (!providerAggregateIsValid(input.totalReviewCount, input.averageRating)) {
    return 'malformed_page'
  }
  if (input.totalReviewCount > 10_000) return 'review_cap_exceeded'
  if (
    input.expectedPageIndex >= 200 ||
    input.observations.length > 50 ||
    input.totalReviewCount < 0
  ) {
    return 'page_cap_exceeded'
  }
  return null
}

/** A confirmation page is only valid inside the run's frozen deadline. */
async function isWithinConfirmationDeadline(tx: Tx, run: RunRow): Promise<boolean> {
  const deadline = await tx.execute(sql`
    SELECT transaction_timestamp() < ${run.confirmationDeadline} AS within_deadline
  `)
  return (
    run.confirmationDeadline != null &&
    (deadline.rows[0] as { within_deadline: boolean } | undefined)?.within_deadline ===
      true
  )
}

function selectPageMember(tx: Tx, run: RunRow, reviewId: string) {
  return tx
    .select()
    .from(reviewProviderSnapshotMembers)
    .where(
      and(
        eq(reviewProviderSnapshotMembers.runId, run.id),
        eq(reviewProviderSnapshotMembers.reviewId, reviewId),
      ),
    )
    .for('update')
}

type SnapshotMemberRow = Awaited<ReturnType<typeof selectPageMember>>[number]

/** Main-scan sighting: each provider resource may be seen exactly once. */
async function markMainScanSeen(
  tx: Tx,
  run: RunRow,
  reviewId: string,
  member: SnapshotMemberRow | undefined,
): Promise<void> {
  if (member?.mainSeen) throw new SnapshotConflict('duplicate_resource')
  if (member == null) {
    await tx
      .insert(reviewProviderSnapshotMembers)
      .values({ runId: run.id, reviewId, mainSeen: true })
    return
  }
  await tx
    .update(reviewProviderSnapshotMembers)
    .set({ mainSeen: true })
    .where(
      and(
        eq(reviewProviderSnapshotMembers.runId, run.id),
        eq(reviewProviderSnapshotMembers.reviewId, reviewId),
      ),
    )
}

/** Confirmation sighting: the resource must already be a main-scan member that
 * has not been confirmed and has not become a deletion candidate. */
async function markConfirmationSeen(
  tx: Tx,
  run: RunRow,
  reviewId: string,
  member: SnapshotMemberRow | undefined,
): Promise<void> {
  if (member == null || !member.mainSeen || member.confirmationSeen) {
    throw new SnapshotConflict('confirmation_set_changed')
  }
  const candidate = await tx
    .select({ state: reviewProviderDeletionCandidates.state })
    .from(reviewProviderDeletionCandidates)
    .where(
      and(
        eq(reviewProviderDeletionCandidates.runId, run.id),
        eq(reviewProviderDeletionCandidates.reviewId, reviewId),
      ),
    )
    .limit(1)
  if (candidate.length > 0) {
    throw new SnapshotConflict('confirmation_set_changed')
  }
  await tx
    .update(reviewProviderSnapshotMembers)
    .set({ confirmationSeen: true })
    .where(
      and(
        eq(reviewProviderSnapshotMembers.runId, run.id),
        eq(reviewProviderSnapshotMembers.reviewId, reviewId),
      ),
    )
}

/** Record every resource on this page against the run's membership set. */
async function recordPageMembership(
  tx: Tx,
  run: RunRow,
  input: PageCommitInput,
): Promise<void> {
  const pageIds = new Set<string>()
  for (const observation of input.observations) {
    if (pageIds.has(observation.reviewId)) {
      throw new SnapshotConflict('duplicate_resource')
    }
    pageIds.add(observation.reviewId)
    await recordObservationMapping(tx, run, observation)

    const members = await selectPageMember(tx, run, observation.reviewId)
    const member = members[0]
    if (input.phase === 'main') {
      await markMainScanSeen(tx, run, observation.reviewId, member)
    } else {
      await markConfirmationSeen(tx, run, observation.reviewId, member)
    }
  }
}

/** Cursor and counter advance for the phase this page belongs to. The main scan
 * additionally freezes the provider aggregate on its first page. */
function pageCommitUpdate(
  run: RunRow,
  input: PageCommitInput,
  nextCount: number,
  nextUnique: number,
) {
  if (input.phase === 'main') {
    return {
      expectedTotal: run.expectedTotal ?? input.totalReviewCount,
      expectedAverageRating:
        run.expectedTotal == null ? input.averageRating : run.expectedAverageRating,
      mainPageCount: nextCount,
      mainUniqueCount: nextUnique,
      mainCursorRef: input.nextCursorRef,
      updatedAt: sql`transaction_timestamp()`,
    }
  }
  return {
    confirmationPageCount: nextCount,
    confirmationUniqueCount: nextUnique,
    confirmationCursorRef: input.nextCursorRef,
    updatedAt: sql`transaction_timestamp()`,
  }
}

async function findSubjectMatches(
  tx: Tx,
  run: RunRow,
  observation: ReviewProviderPersistedObservation,
): Promise<readonly SubjectRow[]> {
  const matches: SubjectRow[] = []
  for (const subject of observation.subjects) {
    const rows = await tx
      .select()
      .from(reviewProviderSubjects)
      .where(
        and(
          eq(reviewProviderSubjects.organizationId, run.organizationId),
          eq(reviewProviderSubjects.propertyId, run.propertyId),
          eq(reviewProviderSubjects.sourceEpoch, run.sourceEpoch),
          eq(reviewProviderSubjects.keyVersion, subject.keyVersion),
          eq(reviewProviderSubjects.locatorHmac, Buffer.from(subject.locatorHmac)),
        ),
      )
      .for('update')
    matches.push(...rows)
  }
  return matches
}

async function recordObservationMapping(
  tx: Tx,
  run: RunRow,
  observation: ReviewProviderPersistedObservation,
): Promise<void> {
  const active = observation.subjects[0]
  if (!active) throw new SnapshotConflict('resource_collision')
  const keyRows = await tx
    .select()
    .from(reviewProviderSubjectHmacKeyVersions)
    .where(
      inArray(
        reviewProviderSubjectHmacKeyVersions.keyVersion,
        observation.subjects.map((subject) => subject.keyVersion),
      ),
    )
    .orderBy(asc(reviewProviderSubjectHmacKeyVersions.generation))
    .for('update')
  const activeKey = keyRows.find((row) => row.state === 'active')
  if (
    activeKey == null ||
    activeKey.keyVersion !== active.keyVersion ||
    keyRows.some((row) => row.state === 'trusted_next')
  ) {
    throw new SnapshotConflict('authorization_changed')
  }

  const matches = await findSubjectMatches(tx, run, observation)
  if (matches.length > 1) throw new SnapshotConflict('resource_collision')
  const match = matches[0]
  if (match == null) {
    const reviewConflict = await tx
      .select({ reviewId: reviewProviderSubjects.reviewId })
      .from(reviewProviderSubjects)
      .where(
        and(
          eq(reviewProviderSubjects.organizationId, run.organizationId),
          eq(reviewProviderSubjects.propertyId, run.propertyId),
          eq(reviewProviderSubjects.sourceEpoch, run.sourceEpoch),
          eq(reviewProviderSubjects.reviewId, observation.reviewId),
        ),
      )
      .for('update')
    if (reviewConflict.length !== 0) throw new SnapshotConflict('duplicate_resource')
    await tx.insert(reviewProviderSubjects).values({
      organizationId: run.organizationId,
      propertyId: run.propertyId,
      sourceEpoch: run.sourceEpoch,
      keyVersion: active.keyVersion,
      locatorHmac: Buffer.from(active.locatorHmac),
      verifierHmac: Buffer.from(active.verifierHmac),
      reviewId: observation.reviewId,
      lastSourceRevision: observation.sourceRevision,
      state: 'linked',
      lastObservedAt: sql`transaction_timestamp()`,
      lastSeenSnapshotRunId: run.id,
    })
    return
  }

  const candidate = observation.subjects.find(
    (subject) =>
      subject.keyVersion === match.keyVersion &&
      hmacEquals(subject.locatorHmac, match.locatorHmac),
  )
  if (
    candidate == null ||
    !hmacEquals(candidate.verifierHmac, match.verifierHmac) ||
    match.reviewId !== observation.reviewId
  ) {
    throw new SnapshotConflict('resource_collision')
  }
  if (match.lastSourceRevision > observation.sourceRevision) {
    throw new SnapshotConflict('review_mutation')
  }

  const activeConflict = await tx
    .select({ reviewId: reviewProviderSubjects.reviewId })
    .from(reviewProviderSubjects)
    .where(
      and(
        eq(reviewProviderSubjects.organizationId, run.organizationId),
        eq(reviewProviderSubjects.propertyId, run.propertyId),
        eq(reviewProviderSubjects.sourceEpoch, run.sourceEpoch),
        eq(reviewProviderSubjects.keyVersion, active.keyVersion),
        eq(reviewProviderSubjects.locatorHmac, Buffer.from(active.locatorHmac)),
      ),
    )
    .for('update')
  if (
    activeConflict.length > 0 &&
    activeConflict.some((row) => row.reviewId !== observation.reviewId)
  ) {
    throw new SnapshotConflict('resource_collision')
  }

  await tx
    .update(reviewProviderSubjects)
    .set({
      keyVersion: active.keyVersion,
      locatorHmac: Buffer.from(active.locatorHmac),
      verifierHmac: Buffer.from(active.verifierHmac),
      lastSourceRevision: observation.sourceRevision,
      state: 'linked',
      lastObservedAt: sql`transaction_timestamp()`,
      lastSeenSnapshotRunId: run.id,
      firstMissingAt: null,
      firstMissingSnapshotRunId: null,
      unlinkedAt: null,
      unlinkExpiresAt: null,
      updatedAt: sql`transaction_timestamp()`,
    })
    .where(
      and(
        eq(reviewProviderSubjects.organizationId, match.organizationId),
        eq(reviewProviderSubjects.propertyId, match.propertyId),
        eq(reviewProviderSubjects.sourceEpoch, match.sourceEpoch),
        eq(reviewProviderSubjects.keyVersion, match.keyVersion),
        eq(reviewProviderSubjects.locatorHmac, match.locatorHmac),
      ),
    )
}

async function recordSourceTransition(
  tx: Tx,
  mapping: SubjectRow,
  change: 'source_expired' | 'provider_deleted',
): Promise<DomainEvent> {
  const sequenceResult = await tx.execute(sql`
    SELECT lock_review_ai_analysis_head_v1(
      ${mapping.organizationId},
      ${mapping.propertyId},
      ${mapping.sourceEpoch}
    ) AS analysis_sequence,
    transaction_timestamp() AS occurred_at
  `)
  const value = sequenceResult.rows[0]
  if (
    value == null ||
    typeof value !== 'object' ||
    !('analysis_sequence' in value) ||
    !('occurred_at' in value)
  ) {
    throw domainError(
      'analysis_head_no_value',
      'Review analysis head transition returned no value',
    )
  }
  const analysisSequence = Number(value.analysis_sequence)
  const occurredAt =
    value.occurred_at instanceof Date
      ? value.occurred_at
      : new Date(String(value.occurred_at))
  if (
    !Number.isSafeInteger(analysisSequence) ||
    analysisSequence < 0 ||
    Number.isNaN(occurredAt.getTime())
  ) {
    throw domainError(
      'analysis_head_invalid_controls',
      'Review analysis head transition returned invalid controls',
    )
  }
  const stamped = await tx
    .update(reviews)
    .set({
      analysisSequence,
      updatedAt: sql`transaction_timestamp()`,
    })
    .where(
      and(
        eq(reviews.id, mapping.reviewId),
        eq(reviews.organizationId, mapping.organizationId),
        eq(reviews.propertyId, mapping.propertyId),
        eq(reviews.sourceEpoch, mapping.sourceEpoch),
        eq(reviews.sourceRevision, mapping.lastSourceRevision),
        eq(reviews.sourceContentState, change),
      ),
    )
    .returning({ id: reviews.id })
  if (!stamped[0]) {
    throw domainError(
      'source_transition_head_changed',
      'Review source transition head changed before it was stamped',
    )
  }
  const event = reviewSourceTransitioned({
    reviewId: reviewId(mapping.reviewId),
    organizationId: organizationId(mapping.organizationId),
    propertyId: propertyId(mapping.propertyId),
    sourceEpoch: mapping.sourceEpoch,
    sourceRevision: mapping.lastSourceRevision,
    analysisSequence,
    change,
    occurredAt,
  })
  await insertOutboxRow(tx, event)
  return event
}

export const createReviewProviderSnapshotRepository = (
  db: Database,
  events: EventBus,
  idGen: () => string,
): ReviewProviderSnapshotRepository => ({
  startOrResume: async (input) =>
    db.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(reviewProviderSnapshotRuns)
        .where(
          and(
            eq(reviewProviderSnapshotRuns.organizationId, input.organizationId),
            eq(reviewProviderSnapshotRuns.propertyId, input.propertyId),
            eq(reviewProviderSnapshotRuns.sourceEpoch, input.sourceEpoch),
            inArray(reviewProviderSnapshotRuns.state, [...ACTIVE_STATES]),
          ),
        )
        .for('update')
      if (existing[0]) return fromRunRow(existing[0])
      const rows = await tx
        .insert(reviewProviderSnapshotRuns)
        .values({
          id: idGen(),
          organizationId: input.organizationId,
          propertyId: input.propertyId,
          sourceEpoch: input.sourceEpoch,
          observationOrigin: input.observationOrigin,
          state: 'scanning',
          phase: 'main',
          startedAt: sql`transaction_timestamp()`,
          expiresAt: sql`transaction_timestamp() + interval '12 hours'`,
        })
        .returning()
      if (!rows[0])
        throw domainError(
          'snapshot_run_insert_empty',
          'Snapshot run insert returned no row',
        )
      return fromRunRow(rows[0])
    }),

  readRun: async (input) => {
    const rows = await db
      .select()
      .from(reviewProviderSnapshotRuns)
      .where(
        and(
          eq(reviewProviderSnapshotRuns.id, input.runId),
          eq(reviewProviderSnapshotRuns.organizationId, input.organizationId),
          eq(reviewProviderSnapshotRuns.propertyId, input.propertyId),
          eq(reviewProviderSnapshotRuns.sourceEpoch, input.sourceEpoch),
        ),
      )
      .limit(1)
    return rows[0] ? fromRunRow(rows[0]) : null
  },
  readExpiredActiveRun: async (input) => {
    const rows = await db
      .select()
      .from(reviewProviderSnapshotRuns)
      .where(
        and(
          eq(reviewProviderSnapshotRuns.organizationId, input.organizationId),
          eq(reviewProviderSnapshotRuns.propertyId, input.propertyId),
          eq(reviewProviderSnapshotRuns.sourceEpoch, input.sourceEpoch),
          inArray(reviewProviderSnapshotRuns.state, [...ACTIVE_STATES]),
          input.runId == null
            ? undefined
            : eq(reviewProviderSnapshotRuns.id, input.runId),
          sql`(
            ${reviewProviderSnapshotRuns.expiresAt} <= transaction_timestamp()
            OR (
              ${reviewProviderSnapshotRuns.state} = 'confirming'
              AND ${reviewProviderSnapshotRuns.confirmationDeadline}
                <= transaction_timestamp()
            )
          )`,
        ),
      )
      .limit(1)
    return rows[0] ? fromRunRow(rows[0]) : null
  },

  commitPage: async (input) =>
    db.transaction(async (tx) => {
      const locked = await tx
        .select()
        .from(reviewProviderSnapshotRuns)
        .where(
          and(
            eq(reviewProviderSnapshotRuns.id, input.runId),
            eq(reviewProviderSnapshotRuns.organizationId, input.organizationId),
          ),
        )
        .for('update')
      const run = locked[0]
      if (!run) throw domainError('snapshot_run_not_found', 'Snapshot run not found')
      const expectedState = input.phase === 'main' ? 'scanning' : 'confirming'
      const pageCount =
        input.phase === 'main' ? run.mainPageCount : run.confirmationPageCount
      const cursor =
        input.phase === 'main' ? run.mainCursorRef : run.confirmationCursorRef
      if (
        run.state !== expectedState ||
        run.phase !== input.phase ||
        pageCount !== input.expectedPageIndex ||
        cursor !== input.expectedCursorRef
      ) {
        return { status: 'stale_page' as const, run: fromRunRow(run) }
      }
      if (
        input.phase === 'confirmation' &&
        !(await isWithinConfirmationDeadline(tx, run))
      ) {
        const failed = await failLockedRun(tx, run, 'confirmation_deadline_elapsed')
        return {
          status: 'failed' as const,
          run: fromRunRow(failed),
          code: 'confirmation_deadline_elapsed' as const,
        }
      }
      try {
        const conflict = pageCommitConflictCode(run, input)
        if (conflict) throw new SnapshotConflict(conflict)
        await recordPageMembership(tx, run, input)

        const nextCount = pageCount + 1
        const nextUnique =
          (input.phase === 'main' ? run.mainUniqueCount : run.confirmationUniqueCount) +
          input.observations.length
        if (nextCount > 200 || nextUnique > 10_000) {
          throw new SnapshotConflict(
            nextCount > 200 ? 'page_cap_exceeded' : 'review_cap_exceeded',
          )
        }
        const rows = await tx
          .update(reviewProviderSnapshotRuns)
          .set(pageCommitUpdate(run, input, nextCount, nextUnique))
          .where(eq(reviewProviderSnapshotRuns.id, run.id))
          .returning()
        if (!rows[0])
          throw domainError(
            'snapshot_page_update_empty',
            'Snapshot page update returned no row',
          )
        return {
          status: 'committed' as const,
          run: fromRunRow(rows[0]),
          finalPage: input.nextCursorRef == null,
        }
      } catch (error) {
        const code = failCode(error)
        const failed = await failLockedRun(tx, run, code)
        return { status: 'failed' as const, run: fromRunRow(failed), code }
      }
    }),

  finishMainScan: async ({ runId }) =>
    db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(reviewProviderSnapshotRuns)
        .where(eq(reviewProviderSnapshotRuns.id, runId))
        .for('update')
      const run = rows[0]
      if (!run) throw domainError('snapshot_run_not_found', 'Snapshot run not found')
      if (run.state !== 'scanning' || run.phase !== 'main') {
        if (run.state === 'confirming') {
          return { status: 'confirming' as const, run: fromRunRow(run) }
        }
        const code = run.failureCode as ReviewProviderSnapshotFailureCode
        return { status: 'failed' as const, run: fromRunRow(run), code }
      }
      if (
        run.mainCursorRef != null ||
        run.mainPageCount < 1 ||
        !providerAggregateIsValid(run.expectedTotal, run.expectedAverageRating) ||
        run.mainUniqueCount !== run.expectedTotal
      ) {
        const failed = await failLockedRun(tx, run, 'set_mismatch')
        return {
          status: 'failed' as const,
          run: fromRunRow(failed),
          code: 'set_mismatch' as const,
        }
      }

      await tx.execute(sql`
        INSERT INTO review_provider_deletion_candidates
          (run_id, review_id, expected_mapping_state, expected_source_revision, state)
        SELECT ${run.id}, s.review_id, s.state, s.last_source_revision, 'pending'
        FROM review_provider_subjects s
        LEFT JOIN review_provider_snapshot_members m
          ON m.run_id = ${run.id} AND m.review_id = s.review_id AND m.main_seen
        WHERE s.organization_id = ${run.organizationId}
          AND s.property_id = ${run.propertyId}
          AND s.source_epoch = ${run.sourceEpoch}
          AND s.state IN ('linked', 'source_expired')
          AND s.last_observed_at <= ${run.startedAt}
          AND m.review_id IS NULL
          AND s.first_missing_at IS NOT NULL
          AND s.first_missing_snapshot_run_id <> ${run.id}
          AND s.first_missing_at <= ${run.startedAt}::timestamptz - interval '15 minutes'
        ON CONFLICT (run_id, review_id) DO NOTHING
      `)
      await tx.execute(sql`
        UPDATE review_provider_subjects s
        SET first_missing_at = COALESCE(s.first_missing_at, transaction_timestamp()),
            first_missing_snapshot_run_id = COALESCE(s.first_missing_snapshot_run_id, ${run.id}),
            updated_at = transaction_timestamp()
        WHERE s.organization_id = ${run.organizationId}
          AND s.property_id = ${run.propertyId}
          AND s.source_epoch = ${run.sourceEpoch}
          AND s.state IN ('linked', 'source_expired')
          AND s.last_observed_at <= ${run.startedAt}
          AND NOT EXISTS (
            SELECT 1 FROM review_provider_snapshot_members m
            WHERE m.run_id = ${run.id} AND m.review_id = s.review_id AND m.main_seen
          )
      `)
      const updated = await tx
        .update(reviewProviderSnapshotRuns)
        .set({
          state: 'confirming',
          phase: 'confirmation',
          mainCursorRef: null,
          // `::timestamptz` is load-bearing: with an untyped bind Postgres
          // resolves `$n + interval` as `interval + interval`, so the parameter
          // becomes an interval. That is what made `finishMainScan` fail with
          // `operator does not exist: timestamp with time zone <= interval`
          // the first time a run ever reached it.
          confirmationDeadline: sql`${run.startedAt}::timestamptz + interval '12 hours'`,
          updatedAt: sql`transaction_timestamp()`,
        })
        .where(eq(reviewProviderSnapshotRuns.id, run.id))
        .returning()
      if (!updated[0])
        throw domainError(
          'snapshot_confirmation_transition_failed',
          'Snapshot confirmation transition failed',
        )
      return { status: 'confirming' as const, run: fromRunRow(updated[0]) }
    }),

  readNextLinkedCandidate: async ({ runId }) => {
    const rows = await db.execute(sql`
      SELECT c.run_id, c.review_id, c.expected_mapping_state,
             c.expected_source_revision, c.state,
             r.external_location_id || '/reviews/' || r.external_id AS review_name
      FROM review_provider_deletion_candidates c
      JOIN review_provider_snapshot_runs run ON run.id = c.run_id
      JOIN reviews r ON r.id = c.review_id
        AND r.organization_id = run.organization_id
        AND r.property_id = run.property_id
        AND r.source_epoch = run.source_epoch
      WHERE c.run_id = ${runId}
        AND c.state = 'pending'
        AND run.confirmation_deadline > transaction_timestamp()
        AND c.expected_mapping_state = 'linked'
      ORDER BY c.review_id
      LIMIT 1
    `)
    const row = rows.rows[0]
    if (row == null) return null
    const value = row as {
      run_id: string
      review_id: string
      expected_mapping_state: 'linked'
      expected_source_revision: number
      state: 'pending'
      review_name: string
    }
    return {
      runId: value.run_id,
      reviewId: reviewId(value.review_id),
      expectedState: value.expected_mapping_state,
      expectedSourceRevision: Number(value.expected_source_revision),
      status: value.state,
      reviewName: value.review_name,
    }
  },

  confirmLinkedCandidateMissing: async (input) =>
    db.transaction(async (tx) => {
      const rows = await tx.execute(sql`
        UPDATE review_provider_deletion_candidates c
        SET state = 'confirmed_missing', updated_at = transaction_timestamp()
        FROM review_provider_snapshot_runs run, review_provider_subjects s
        WHERE c.run_id = ${input.runId}
          AND c.review_id = ${input.reviewId}
          AND c.expected_source_revision = ${input.expectedSourceRevision}
          AND c.state = 'pending'
          AND run.id = c.run_id AND run.state = 'confirming'
          AND s.organization_id = run.organization_id
          AND s.property_id = run.property_id
          AND s.source_epoch = run.source_epoch
          AND s.review_id = c.review_id
          AND s.state = 'linked'
          AND s.last_source_revision = c.expected_source_revision
          AND s.first_missing_snapshot_run_id IS NOT NULL
        RETURNING c.review_id
      `)
      return rows.rowCount === 1 ? 'confirmed' : 'stale'
    }),

  recordCandidateObservation: async ({ runId, organizationId, observation }) =>
    db.transaction(async (tx) => {
      const runs = await tx
        .select()
        .from(reviewProviderSnapshotRuns)
        .where(
          and(
            eq(reviewProviderSnapshotRuns.id, runId),
            eq(reviewProviderSnapshotRuns.organizationId, organizationId),
          ),
        )
        .for('update')
      const run = runs[0]
      if (!run || run.state !== 'confirming') return 'run_failed'
      try {
        await recordObservationMapping(tx, run, observation)
      } catch {
        return 'stale'
      }
      const candidate = await tx
        .update(reviewProviderDeletionCandidates)
        .set({ state: 'observed', updatedAt: sql`transaction_timestamp()` })
        .where(
          and(
            eq(reviewProviderDeletionCandidates.runId, runId),
            eq(reviewProviderDeletionCandidates.reviewId, observation.reviewId),
            eq(reviewProviderDeletionCandidates.state, 'pending'),
          ),
        )
        .returning({ reviewId: reviewProviderDeletionCandidates.reviewId })
      if (!candidate[0]) return 'stale'
      await failLockedRun(tx, run, 'confirmation_set_changed')
      return 'observed_run_failed'
    }),

  beginConfirmationScan: async ({ runId, organizationId }) =>
    db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(reviewProviderSnapshotRuns)
        .where(
          and(
            eq(reviewProviderSnapshotRuns.id, runId),
            eq(reviewProviderSnapshotRuns.organizationId, organizationId),
          ),
        )
        .for('update')
      const run = rows[0]
      if (!run) throw domainError('snapshot_run_not_found', 'Snapshot run not found')
      if (run.state !== 'confirming' || run.phase !== 'confirmation') {
        throw domainError('snapshot_run_not_confirming', 'Snapshot run is not confirming')
      }
      const pending = await tx
        .select({ reviewId: reviewProviderDeletionCandidates.reviewId })
        .from(reviewProviderDeletionCandidates)
        .where(
          and(
            eq(reviewProviderDeletionCandidates.runId, run.id),
            eq(reviewProviderDeletionCandidates.state, 'pending'),
            eq(reviewProviderDeletionCandidates.expectedMappingState, 'linked'),
          ),
        )
        .limit(1)
      if (pending.length > 0)
        throw domainError(
          'targeted_confirmations_remain',
          'Targeted confirmations remain',
        )
      return fromRunRow(run)
    }),

  finishConfirmationScan: async ({ runId, organizationId }) =>
    db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(reviewProviderSnapshotRuns)
        .where(
          and(
            eq(reviewProviderSnapshotRuns.id, runId),
            eq(reviewProviderSnapshotRuns.organizationId, organizationId),
          ),
        )
        .for('update')
      const run = rows[0]
      if (!run) throw domainError('snapshot_run_not_found', 'Snapshot run not found')
      if (run.state === 'deleting') {
        return { status: 'deleting' as const, run: fromRunRow(run) }
      }
      const nowRows = await tx.execute(sql`SELECT transaction_timestamp() AS now`)
      const now = (nowRows.rows[0] as { now: Date }).now
      const memberMismatch = await tx.execute(sql`
        SELECT 1
        FROM review_provider_snapshot_members
        WHERE run_id = ${run.id} AND (NOT main_seen OR NOT confirmation_seen)
        LIMIT 1
      `)
      if (
        run.state !== 'confirming' ||
        run.phase !== 'confirmation' ||
        run.confirmationCursorRef != null ||
        !providerAggregateIsValid(run.expectedTotal, run.expectedAverageRating) ||
        run.confirmationUniqueCount !== run.mainUniqueCount ||
        run.mainUniqueCount !== run.expectedTotal ||
        memberMismatch.rowCount !== 0 ||
        run.confirmationDeadline == null ||
        now >= run.confirmationDeadline
      ) {
        const code =
          run.confirmationDeadline != null && now >= run.confirmationDeadline
            ? 'confirmation_deadline_elapsed'
            : 'confirmation_set_changed'
        const failed = await failLockedRun(tx, run, code)
        return { status: 'failed' as const, run: fromRunRow(failed), code }
      }
      await tx
        .update(reviewProviderDeletionCandidates)
        .set({ state: 'confirmed_missing', updatedAt: sql`transaction_timestamp()` })
        .where(
          and(
            eq(reviewProviderDeletionCandidates.runId, run.id),
            eq(reviewProviderDeletionCandidates.state, 'pending'),
            eq(reviewProviderDeletionCandidates.expectedMappingState, 'source_expired'),
          ),
        )
      const pending = await tx
        .select({ reviewId: reviewProviderDeletionCandidates.reviewId })
        .from(reviewProviderDeletionCandidates)
        .where(
          and(
            eq(reviewProviderDeletionCandidates.runId, run.id),
            eq(reviewProviderDeletionCandidates.state, 'pending'),
          ),
        )
        .limit(1)
      if (pending.length > 0) {
        const failed = await failLockedRun(tx, run, 'confirmation_set_changed')
        return {
          status: 'failed' as const,
          run: fromRunRow(failed),
          code: 'confirmation_set_changed' as const,
        }
      }
      const updated = await tx
        .update(reviewProviderSnapshotRuns)
        .set({
          state: 'deleting',
          phase: 'apply',
          confirmationCursorRef: null,
          updatedAt: sql`transaction_timestamp()`,
        })
        .where(eq(reviewProviderSnapshotRuns.id, run.id))
        .returning()
      if (!updated[0])
        throw domainError(
          'snapshot_deleting_transition_failed',
          'Snapshot deleting transition failed',
        )
      return { status: 'deleting' as const, run: fromRunRow(updated[0]) }
    }),

  failRun: async ({ runId, organizationId, code }) =>
    db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(reviewProviderSnapshotRuns)
        .where(
          and(
            eq(reviewProviderSnapshotRuns.id, runId),
            eq(reviewProviderSnapshotRuns.organizationId, organizationId),
          ),
        )
        .for('update')
      if (!rows[0]) throw domainError('snapshot_run_not_found', 'Snapshot run not found')
      return fromRunRow(await failLockedRun(tx, rows[0], code))
    }),

  applyDeletionBatch: async ({ runId, limit }) => {
    if (limit !== 100)
      throw new TypeError('Provider deletion batch must contain 100 rows')
    const emitted: DomainEvent[] = []
    const result = await db.transaction(async (tx) => {
      const runRows = await tx
        .select()
        .from(reviewProviderSnapshotRuns)
        .where(eq(reviewProviderSnapshotRuns.id, runId))
        .for('update')
      const run = runRows[0]
      if (!run) throw domainError('snapshot_run_not_found', 'Snapshot run not found')
      if (run.state === 'completed') {
        return { run: fromRunRow(run), applied: 0, observed: 0, done: true }
      }
      if (run.state !== 'deleting')
        throw domainError('snapshot_run_not_deleting', 'Snapshot run is not deleting')
      const candidates = await tx
        .select()
        .from(reviewProviderDeletionCandidates)
        .where(
          and(
            eq(reviewProviderDeletionCandidates.runId, run.id),
            eq(reviewProviderDeletionCandidates.state, 'confirmed_missing'),
            run.applyCursorReviewId == null
              ? undefined
              : gt(reviewProviderDeletionCandidates.reviewId, run.applyCursorReviewId),
          ),
        )
        .orderBy(asc(reviewProviderDeletionCandidates.reviewId))
        .limit(limit)
        .for('update')

      // The provider-deletion path shares the lifecycle mutation order. Lock
      // every Reply scope before any Review row; mapping locks come last.
      // This prevents Property -> Reply -> Review -> mapping from being
      // inverted by a concurrent expiry or re-observation transaction.
      for (const candidate of candidates) {
        const current = await lockReviewSourceMutationScope(tx, {
          organizationId: organizationId(run.organizationId),
          propertyId: propertyId(run.propertyId),
          reviewId: reviewId(candidate.reviewId),
          sourceEpoch: run.sourceEpoch,
        })
        if (!current) {
          throw domainError(
            'snapshot_source_epoch_changed',
            'Provider snapshot source epoch changed before deletion',
          )
        }
      }
      const lockedReviews: LockedDeletionReview[] =
        candidates.length === 0
          ? []
          : await selectLockedDeletionReviews(
              tx,
              candidates.map((candidate) => candidate.reviewId),
            )
      const lockedReviewsById = new Map(lockedReviews.map((row) => [row.id, row]))
      let applied = 0
      let observed = 0
      for (const candidate of candidates) {
        const outcome = await applyDeletionCandidate(
          tx,
          run,
          candidate,
          lockedReviewsById.get(candidate.reviewId),
        )
        if (outcome.kind === 'applied') {
          emitted.push(outcome.event)
          applied += 1
        } else {
          observed += 1
        }
      }
      const last = candidates.at(-1)?.reviewId ?? run.applyCursorReviewId
      const more =
        candidates.length === limit
          ? await tx
              .select({ reviewId: reviewProviderDeletionCandidates.reviewId })
              .from(reviewProviderDeletionCandidates)
              .where(
                and(
                  eq(reviewProviderDeletionCandidates.runId, run.id),
                  eq(reviewProviderDeletionCandidates.state, 'confirmed_missing'),
                  last == null
                    ? undefined
                    : gt(reviewProviderDeletionCandidates.reviewId, last),
                ),
              )
              .limit(1)
          : []
      const done = more.length === 0
      if (done) {
        emitted.push(await recordVerifiedSnapshotFact(tx, run))
      }
      const updated = await tx
        .update(reviewProviderSnapshotRuns)
        .set(
          done
            ? {
                state: 'completed',
                phase: 'terminal',
                applyCursorReviewId: last,
                terminalAt: sql`transaction_timestamp()`,
                recordExpiresAt: sql`transaction_timestamp() + interval '30 days'`,
                updatedAt: sql`transaction_timestamp()`,
              }
            : {
                applyCursorReviewId: last,
                updatedAt: sql`transaction_timestamp()`,
              },
        )
        .where(eq(reviewProviderSnapshotRuns.id, run.id))
        .returning()
      if (!updated[0])
        throw domainError(
          'snapshot_apply_checkpoint_failed',
          'Snapshot apply checkpoint failed',
        )
      return { run: fromRunRow(updated[0]), applied, observed, done }
    })
    for (const event of emitted) await emitAfterCommit(events, event)
    return result
  },

  expireRawSourceBatch: async ({ beforeOrAt, afterReviewId, limit }) => {
    if (limit < 1 || limit > 100) throw new TypeError('Raw expiry batch is out of bounds')

    // Compatibility report only. Translate the legacy Review-id cursor into
    // the canonical frozen checkpoint, then delegate to the sole lifecycle
    // application authority. No authorizer or apply confirmation is present.
    let checkpoint = undefined
    if (afterReviewId != null) {
      const checkpointRows = await db
        .select({ createdAt: reviews.createdAt })
        .from(reviews)
        .where(eq(reviews.id, afterReviewId))
        .limit(1)
      if (checkpointRows[0] == null) {
        throw domainError(
          'raw_expiry_checkpoint_missing',
          'Raw expiry checkpoint Review no longer exists',
        )
      }
      checkpoint = {
        contract: REVIEW_SOURCE_CONTENT_LIFECYCLE_CONTRACT,
        mode: 'report' as const,
        scope: { kind: 'expired' as const },
        evaluatedAt: beforeOrAt.toISOString(),
        after: {
          createdAt: checkpointRows[0].createdAt.toISOString(),
          reviewId: afterReviewId,
        },
      }
    }

    const report = await createRunReviewSourceContentLifecycle({
      store: createReviewSourceContentLifecycleStore(db),
      clock: () => beforeOrAt,
    })({
      mode: 'report',
      scope: { kind: 'expired' },
      batchSize: limit,
      ...(checkpoint == null ? {} : { checkpoint }),
    })
    return {
      transitioned: 0,
      nextReviewId:
        report.nextCheckpoint == null
          ? null
          : reviewId(report.nextCheckpoint.after.reviewId),
    }
  },

  sweepExpiredTombstones: async ({ beforeOrAt, afterReviewId, limit }) => {
    if (limit < 1 || limit > 100) throw new TypeError('Tombstone batch is out of bounds')
    return db.transaction(async (tx) => {
      const rows = await tx
        .select({
          organizationId: reviewProviderSubjects.organizationId,
          propertyId: reviewProviderSubjects.propertyId,
          sourceEpoch: reviewProviderSubjects.sourceEpoch,
          keyVersion: reviewProviderSubjects.keyVersion,
          locatorHmac: reviewProviderSubjects.locatorHmac,
          reviewId: reviewProviderSubjects.reviewId,
        })
        .from(reviewProviderSubjects)
        .where(
          and(
            lte(reviewProviderSubjects.unlinkExpiresAt, beforeOrAt),
            afterReviewId == null
              ? undefined
              : gt(reviewProviderSubjects.reviewId, afterReviewId),
          ),
        )
        .orderBy(asc(reviewProviderSubjects.reviewId))
        .limit(limit)
        .for('update', { skipLocked: true })
      for (const row of rows) {
        await tx
          .delete(reviewProviderSubjects)
          .where(
            and(
              eq(reviewProviderSubjects.organizationId, row.organizationId),
              eq(reviewProviderSubjects.propertyId, row.propertyId),
              eq(reviewProviderSubjects.sourceEpoch, row.sourceEpoch),
              eq(reviewProviderSubjects.keyVersion, row.keyVersion),
              eq(reviewProviderSubjects.locatorHmac, row.locatorHmac),
            ),
          )
      }
      await tx
        .delete(reviewProviderSnapshotRuns)
        .where(lte(reviewProviderSnapshotRuns.recordExpiresAt, beforeOrAt))
      return {
        deleted: rows.length,
        nextReviewId: rows.length === limit ? reviewId(rows.at(-1)!.reviewId) : null,
      }
    })
  },
})
