// Review context — queue port for BullMQ job dispatch
// Per architecture: "BullMQ job dispatch as cross-context mechanism."

// BullMQ serializes job data to JSON — branded types are just strings at runtime.
// Consumer (sync-property-reviews.job) re-brands via id constructors.
// Using string here avoids serialization overhead and keeps BullMQ dashboard readable.
import type { JobEnqueueAttribution } from '#/shared/jobs/delayed-execution-gate'
import type { RoutingEnvelope } from '#/shared/routing/processing-router'

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
    /**
     * BQC-4.2: content-free routing envelope stamped at enqueue. Telemetry
     * only — the worker re-resolves routing at dispatch; a payload region is
     * never accepted as authority (ADR 0048).
     */
    routing?: RoutingEnvelope
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
    routing?: RoutingEnvelope
  }>

export type ReviewProviderJobData =
  SyncPropertyReviewsJobData | TargetedGoogleReviewFetchJobData

export type AddSyncJobOptions = Readonly<{
  jobId?: string
  /**
   * Delay before the job becomes runnable. Set on rate-limited continuations:
   * that path checkpoints WITHOUT advancing the cursor, so an undelayed
   * continuation repeats the denied call at queue speed.
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

export type TargetedGoogleReviewQueuePort = Readonly<{
  addTargetedFetchJob(
    data: TargetedGoogleReviewFetchJobData,
    options: Readonly<{ jobId: string }>,
  ): Promise<void>
}>
