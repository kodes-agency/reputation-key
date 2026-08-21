import type {
  GoogleConnectionId,
  OrganizationId,
  PropertyId,
  ReviewId,
} from '#/shared/domain/ids'
import type { GoogleReview } from '../../domain/types'
import type { ReviewProviderSubject } from '#/shared/review-provider-subject-contract'

export const REVIEW_PROVIDER_SNAPSHOT_MAX_PAGES = 200
export const REVIEW_PROVIDER_SNAPSHOT_MAX_REVIEWS = 10_000
export const REVIEW_PROVIDER_SNAPSHOT_PAGE_SIZE = 50
export const REVIEW_PROVIDER_DELETION_BATCH_SIZE = 100

export type ReviewProviderSnapshotPagePhase = 'main' | 'confirmation'
export type ReviewProviderSnapshotPhase =
  ReviewProviderSnapshotPagePhase | 'apply' | 'terminal'
export type ReviewProviderSnapshotState =
  'scanning' | 'confirming' | 'deleting' | 'completed' | 'failed'

export type ReviewProviderSnapshotFailureCode =
  | 'source_changed'
  | 'authorization_changed'
  | 'provider_failure'
  | 'cursor_failure'
  | 'malformed_page'
  | 'total_changed'
  | 'duplicate_resource'
  | 'resource_collision'
  | 'review_mutation'
  | 'page_cap_exceeded'
  | 'review_cap_exceeded'
  | 'set_mismatch'
  | 'confirmation_deadline_elapsed'
  | 'confirmation_set_changed'
  | 'observation_failed'

export type ReviewProviderSnapshotRun = Readonly<{
  id: string
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceEpoch: number
  state: ReviewProviderSnapshotState
  phase: ReviewProviderSnapshotPhase
  startedAt: Date
  expectedProviderTotal: number | null
  mainPageIndex: number
  mainCursorRef: string | null
  mainUniqueCount: number
  confirmationPageIndex: number
  confirmationCursorRef: string | null
  confirmationUniqueCount: number
  confirmationDeadline: Date | null
  applyCursorReviewId: ReviewId | null
  terminalAt: Date | null
  failureCode: ReviewProviderSnapshotFailureCode | null
}>

export type ReviewProviderSubjectCandidates = readonly [
  ReviewProviderSubject,
  ...ReviewProviderSubject[],
]

/**
 * Result of the normal Review source writer. Provider identifiers exist only in
 * the request-scoped input; the result is content-free and can be committed to
 * snapshot metadata.
 */
export type ReviewProviderPersistedObservation = Readonly<{
  reviewId: ReviewId
  sourceRevision: number
  review: GoogleReview
  subjects: ReviewProviderSubjectCandidates
  /**
   * True when this write CREATED the review locally — no row existed for the
   * provider's external id in this organization. This is the only place the
   * new-vs-seen decision is made, and it is what stamps
   * review_sync_state.last_new_review_at for the discovery backoff ladder.
   */
  isNew: boolean
}>

export type ReviewProviderSnapshotPageCommit = Readonly<{
  runId: string
  phase: ReviewProviderSnapshotPagePhase
  expectedPageIndex: number
  expectedCursorRef: string | null
  totalReviewCount: number
  nextCursorRef: string | null
  observations: readonly ReviewProviderPersistedObservation[]
}>

export type ReviewProviderSnapshotPageCommitResult =
  | Readonly<{ status: 'committed'; run: ReviewProviderSnapshotRun; finalPage: boolean }>
  | Readonly<{ status: 'stale_page'; run: ReviewProviderSnapshotRun }>
  | Readonly<{
      status: 'failed'
      run: ReviewProviderSnapshotRun
      code: ReviewProviderSnapshotFailureCode
    }>

export type ReviewProviderDeletionCandidate = Readonly<{
  runId: string
  reviewId: ReviewId
  expectedState: 'linked' | 'source_expired'
  expectedSourceRevision: number
  status: 'pending' | 'confirmed_missing' | 'observed'
}>

export type ReviewProviderLinkedCandidate = ReviewProviderDeletionCandidate &
  Readonly<{
    expectedState: 'linked'
    /** Request-scoped only. It is read from the locked canonical Review row. */
    reviewName: string
  }>

export type ReviewProviderSnapshotRepository = Readonly<{
  startOrResume(
    input: Readonly<{
      organizationId: OrganizationId
      propertyId: PropertyId
      sourceEpoch: number
    }>,
  ): Promise<ReviewProviderSnapshotRun>

  readRun(
    input: Readonly<{
      organizationId: OrganizationId
      propertyId: PropertyId
      sourceEpoch: number
      runId: string
    }>,
  ): Promise<ReviewProviderSnapshotRun | null>
  readExpiredActiveRun(
    input: Readonly<{
      organizationId: OrganizationId
      propertyId: PropertyId
      sourceEpoch: number
      runId?: string
    }>,
  ): Promise<ReviewProviderSnapshotRun | null>

  commitPage(
    input: ReviewProviderSnapshotPageCommit,
  ): Promise<ReviewProviderSnapshotPageCommitResult>

  finishMainScan(
    input: Readonly<{
      runId: string
    }>,
  ): Promise<
    | Readonly<{ status: 'confirming'; run: ReviewProviderSnapshotRun }>
    | Readonly<{
        status: 'failed'
        run: ReviewProviderSnapshotRun
        code: ReviewProviderSnapshotFailureCode
      }>
  >

  readNextLinkedCandidate(
    input: Readonly<{
      runId: string
    }>,
  ): Promise<ReviewProviderLinkedCandidate | null>

  confirmLinkedCandidateMissing(
    input: Readonly<{
      runId: string
      reviewId: ReviewId
      expectedSourceRevision: number
    }>,
  ): Promise<'confirmed' | 'stale' | 'run_failed'>

  recordCandidateObservation(
    input: Readonly<{
      runId: string
      observation: ReviewProviderPersistedObservation
    }>,
  ): Promise<'observed_run_failed' | 'stale' | 'run_failed'>

  beginConfirmationScan(
    input: Readonly<{
      runId: string
    }>,
  ): Promise<ReviewProviderSnapshotRun>

  finishConfirmationScan(
    input: Readonly<{
      runId: string
    }>,
  ): Promise<
    | Readonly<{ status: 'deleting'; run: ReviewProviderSnapshotRun }>
    | Readonly<{
        status: 'failed'
        run: ReviewProviderSnapshotRun
        code: ReviewProviderSnapshotFailureCode
      }>
  >

  failRun(
    input: Readonly<{
      runId: string
      code: ReviewProviderSnapshotFailureCode
    }>,
  ): Promise<ReviewProviderSnapshotRun>

  applyDeletionBatch(
    input: Readonly<{
      runId: string
      limit: typeof REVIEW_PROVIDER_DELETION_BATCH_SIZE
    }>,
  ): Promise<
    Readonly<{
      run: ReviewProviderSnapshotRun
      applied: number
      observed: number
      done: boolean
    }>
  >

  expireRawSourceBatch(
    input: Readonly<{
      beforeOrAt: Date
      afterReviewId: ReviewId | null
      limit: number
    }>,
  ): Promise<Readonly<{ transitioned: number; nextReviewId: ReviewId | null }>>

  sweepExpiredTombstones(
    input: Readonly<{
      beforeOrAt: Date
      afterReviewId: ReviewId | null
      limit: number
    }>,
  ): Promise<Readonly<{ deleted: number; nextReviewId: ReviewId | null }>>
}>

/** Request-scoped source writer supplied by the normal Review sync path. */
export type ReviewProviderObservationWriter = Readonly<{
  persist(
    input: Readonly<{
      organizationId: OrganizationId
      propertyId: PropertyId
      connectionId: GoogleConnectionId
      sourceEpoch: number
      review: GoogleReview
    }>,
  ): Promise<Readonly<{ reviewId: ReviewId; sourceRevision: number; isNew: boolean }>>
}>
