// Review context — queue port for BullMQ job dispatch
// Per architecture: "BullMQ job dispatch as cross-context mechanism."

// BullMQ serializes job data to JSON — branded types are just strings at runtime.
// Consumer (sync-property-reviews.job) re-brands via id constructors.
// Using string here avoids serialization overhead and keeps BullMQ dashboard readable.
import type { JobPolicyContext } from '#/shared/jobs/delayed-execution-gate'
import type { RoutingEnvelope } from '#/shared/routing/processing-router'

export type SyncPropertyReviewsJobData = Readonly<{
  propertyId: string
  organizationId: string
  connectionId: string
  locationName: string
  /** BQC-3.2: content-free policy context stamped at enqueue. */
  policy?: JobPolicyContext
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

export type ReviewQueuePort = Readonly<{
  addSyncJob: (
    data: SyncPropertyReviewsJobData,
    options?: AddSyncJobOptions,
  ) => Promise<void>
}>
