import type { OrganizationId, PropertyId, ReviewId } from '#/shared/domain/ids'
import type { ReviewLifecycleRecoveryExecutionIdentity } from './lifecycle-recovery-execution-store.port'

export type ReviewSourceContentLifecycleMode = 'report' | 'shadow' | 'apply'
export type ReviewSourceContentLifecycleInspectionMode = Exclude<
  ReviewSourceContentLifecycleMode,
  'apply'
>

export type ReviewSourceContentState = 'active' | 'source_expired' | 'provider_deleted'

export type ReviewSourceContentShadowFinding =
  | 'active_source_cache_missing'
  | 'active_compatibility_drift'
  | 'active_observation_missing'
  | 'active_observation_drift'
  | 'active_material_revision_missing'
  | 'active_material_revision_drift'
  | 'active_google_sync_reply_redundant'
  | 'active_google_sync_reply_unreconciled'
  | 'tombstone_source_cache_present'
  | 'tombstone_compatibility_content_present'
  | 'tombstone_observation_content_present'
  | 'tombstone_material_content_present'
  | 'tombstone_google_reply_content_present'
  | 'tombstone_google_sync_reply_present'

export type ReviewSourceContentLifecycleCursor = Readonly<{
  createdAt: Date
  reviewId: ReviewId
}>

/**
 * Content-free evidence returned by Review infrastructure. Provider values
 * are compared inside PostgreSQL and never cross the lifecycle port.
 */
export type ReviewSourceContentLifecycleInspection = Readonly<{
  reviewId: ReviewId
  createdAt: Date
  sourceContentState: ReviewSourceContentState
  /** Canonical expand-cache clock. Missing canonical state is unverifiable. */
  lifecycleClock: Date | null
  shadowFindings: ReadonlyArray<ReviewSourceContentShadowFinding>
}>

export type ReviewSourceContentLifecycleScope =
  | Readonly<{
      kind: 'expired'
      /** Test/operator partition seam; normal recurring cutover is global. */
      organizationId?: OrganizationId
    }>
  | Readonly<{
      kind: 'connection'
      organizationId: OrganizationId
      connectionId: string
    }>
  | Readonly<{
      kind: 'property'
      organizationId: OrganizationId
      propertyId: PropertyId
    }>
  | Readonly<{
      kind: 'organization'
      organizationId: OrganizationId
    }>

/** @deprecated Use the mode-neutral lifecycle scope name. */
export type ReviewSourceContentLifecycleApplyScope = ReviewSourceContentLifecycleScope

/**
 * One transactionally applied page. Provider content never crosses this port;
 * the rows are the same content-free pre-apply inspection facts used by shadow.
 */
export type ReviewSourceContentLifecycleAppliedBatch = Readonly<{
  rows: ReadonlyArray<ReviewSourceContentLifecycleInspection>
  hasMore: boolean
  rowsRedacted: number
  legacyGoogleRepliesReconciled: number
}>

export type ReviewSourceContentLifecycleStore = Readonly<{
  readInspectionBatch(
    input: Readonly<{
      evaluatedAt: Date
      after: ReviewSourceContentLifecycleCursor | null
      limit: number
      scope: ReviewSourceContentLifecycleScope
    }>,
  ): Promise<ReadonlyArray<ReviewSourceContentLifecycleInspection>>
  applyLifecycleBatch(
    input: Readonly<{
      evaluatedAt: Date
      after: ReviewSourceContentLifecycleCursor | null
      limit: number
      scope: ReviewSourceContentLifecycleScope
      /**
       * When present, the infrastructure must advance this durable cursor and
       * aggregate evidence in the same transaction as the lifecycle page.
       */
      recoveryExecution?: ReviewLifecycleRecoveryExecutionIdentity
    }>,
  ): Promise<ReviewSourceContentLifecycleAppliedBatch>
}>
