// Review context — queue port for BullMQ job dispatch
// Per architecture: "BullMQ job dispatch as cross-context mechanism."

// BullMQ serializes job data to JSON — branded types are just strings at runtime.
// Consumer (sync-property-reviews.job) re-brands via id constructors.
// Using string here avoids serialization overhead and keeps BullMQ dashboard readable.
import type { JobEnqueueAttribution } from '#/shared/jobs/delayed-execution-gate'

export type SyncPropertyReviewsJobData = JobEnqueueAttribution &
  Readonly<{
    propertyId: string
    organizationId: string
    connectionId: string
    locationName: string
    /** Present only on snapshot continuations; initial jobs resolve it fresh. */
    sourceEpoch?: number
    /** Content-free active snapshot run identity. */
    runId?: string
  }>

/** Identifier-only GBP push work; raw provider resources stay in Redis. */
export type TargetedGoogleReviewFetchJobData = JobEnqueueAttribution &
  Readonly<{
    mode: 'targeted'
    propertyId: string
    organizationId: string
    connectionId: string
    sourceEpoch: number
    referenceRef: string | null
    /** Identifier of the durable push-accepted outbox fact. */
    deliveryId: string
  }>

/**
 * One head check: a single read of Google's newest page, compared with RepKey's
 * stored copies. It runs under the same job family, principal and gate as a
 * snapshot step, carries no run and no cursor, and never changes a review.
 */
export type ReviewHeadCheckJobData = JobEnqueueAttribution &
  Readonly<{
    mode: 'head'
    propertyId: string
    organizationId: string
    connectionId: string
    locationName: string
    /** Absent when enqueued by the discovery sweep; the run resolves it fresh. */
    sourceEpoch?: number
  }>

export type ReviewProviderJobData =
  SyncPropertyReviewsJobData | TargetedGoogleReviewFetchJobData | ReviewHeadCheckJobData

export type AddSyncJobOptions = Readonly<{
  jobId?: string
  /**
   * Delay before the job becomes runnable. Set by exactly two callers:
   *  - rate-limited continuations: that path checkpoints WITHOUT advancing the
   *    cursor, so an undelayed continuation repeats the denied call at queue
   *    speed;
   *  - the discover-new-reviews sweep, which staggers the starts of one sweep's
   *    jobs over a bounded window (domain/discovery-spread.ts).
   * Push, import and user-initiated syncs enqueue with no delay.
   */
  delayMs?: number
}>

/**
 * Attribution stamped by the GBP Pub/Sub webhook path on the sync job it
 * enqueues. Review owns this payload contract, and the sync handler reads the
 * marker to stamp the property's push liveness for the discovery backoff
 * ladder — so the literal must have exactly one definition.
 */
export const GBP_PUSH_SYNC_INITIATOR_ID = 'webhook:gbp'

/** Initial Google property import; reviews first seen by this run are history. */
export const GOOGLE_PROPERTY_IMPORT_SYNC_INITIATOR_ID = 'google-property-import'

/** Attribution stamped by the discover-new-reviews sweep. */
export const DISCOVERY_SWEEP_SYNC_INITIATOR_ID = 'sweep:review-discovery'

export type ReviewQueuePort = Readonly<{
  addSyncJob: (
    data: SyncPropertyReviewsJobData,
    options?: AddSyncJobOptions,
  ) => Promise<void>
}>

export type ReviewHeadCheckQueuePort = Readonly<{
  addHeadCheckJob(
    data: ReviewHeadCheckJobData,
    options: Readonly<{
      /** One per Property and time bucket (domain/head-check.ts `headCheckJobId`). */
      jobId: string
      /** The sweep's stable per-Property start delay, so a sweep's heads do not all start at once. */
      delayMs?: number
    }>,
  ): Promise<void>
}>

export type TargetedGoogleReviewQueuePort = Readonly<{
  addTargetedFetchJob(
    data: TargetedGoogleReviewFetchJobData,
    options: Readonly<{ jobId: string }>,
  ): Promise<void>
}>
