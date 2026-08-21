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

export type AddSyncJobOptions = Readonly<{
  jobId?: string
}>

/**
 * Attribution stamped by the GBP Pub/Sub webhook path on the sync job it
 * enqueues. Review owns this payload contract, and the sync handler reads the
 * marker to stamp the property's push liveness for the discovery backoff
 * ladder — so the literal must have exactly one definition.
 */
export const GBP_PUSH_SYNC_INITIATOR_ID = 'webhook:gbp'

/** Attribution stamped by the discover-new-reviews sweep. */
export const DISCOVERY_SWEEP_SYNC_INITIATOR_ID = 'sweep:review-discovery'

export type ReviewQueuePort = Readonly<{
  addSyncJob: (
    data: SyncPropertyReviewsJobData,
    options?: AddSyncJobOptions,
  ) => Promise<void>
}>
