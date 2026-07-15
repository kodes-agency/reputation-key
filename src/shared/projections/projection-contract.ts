// BETA-1 B1.11: Projection contracts — replay-safe core projections.
//
// Each projection context (inbox, activity, metric, dashboard, notification)
// declares its source events, version ordering, rebuild behavior, and
// freshness guarantees. This ensures:
//
// 1. Replay from an event range produces the same projection without duplicates
// 2. A projection outage does not block canonical review ingestion
// 3. Dashboard/metric results are property-scoped and policy-permitted
// 4. Users see honest freshness/degraded status

// ── Projection metadata ────────────────────────────────────────────

export type ProjectionContext =
  | 'inbox'
  | 'activity'
  | 'metric'
  | 'dashboard'
  | 'notification'

/**
 * Declares a projection's source contract: what events feed it,
 * how to detect duplicates, and how to rebuild from scratch.
 */
export type ProjectionContract = Readonly<{
  /** Which context owns this projection. */
  context: ProjectionContext

  /** Event types this projection consumes. */
  sourceEvents: readonly string[]

  /** Whether this projection is idempotent (safe to replay). */
  idempotent: boolean

  /** Whether the projection supports bounded rebuild. */
  rebuildable: boolean

  /** Maximum acceptable staleness before showing "degraded" to users. */
  maxStalenessMs: number
}>

/**
 * The canonical projection contracts for BETA-1.
 * Each context declares its replay safety guarantees.
 */
export const PROJECTION_CONTRACTS: Readonly<
  Record<ProjectionContext, ProjectionContract>
> = {
  inbox: {
    context: 'inbox',
    sourceEvents: [
      'review.created',
      'review.updated',
      'review.expired',
      'reply.published',
      'reply.rejected',
    ],
    idempotent: true,
    rebuildable: true,
    maxStalenessMs: 30_000, // 30 seconds
  },
  activity: {
    context: 'activity',
    sourceEvents: [
      'review.created',
      'reply.published',
      'property.connected',
      'property.disconnected',
    ],
    idempotent: true,
    rebuildable: true,
    maxStalenessMs: 60_000, // 1 minute
  },
  metric: {
    context: 'metric',
    sourceEvents: ['review.created', 'review.updated', 'metric.recorded'],
    idempotent: true,
    rebuildable: true,
    maxStalenessMs: 300_000, // 5 minutes (rollup-based)
  },
  dashboard: {
    context: 'dashboard',
    sourceEvents: ['review.created', 'review.updated', 'metric.recorded'],
    idempotent: true,
    rebuildable: true,
    maxStalenessMs: 300_000, // 5 minutes (rollup + cache)
  },
  notification: {
    context: 'notification',
    sourceEvents: [
      'review.created',
      'review.updated',
      'reply.published',
      'inbox.assigned',
    ],
    idempotent: true,
    rebuildable: true,
    maxStalenessMs: 10_000, // 10 seconds
  },
} as const

// ── Replay safety ──────────────────────────────────────────────────

/**
 * Check if a projection is stale based on its last update timestamp.
 */
export function isProjectionStale(
  context: ProjectionContext,
  lastUpdatedAt: Date,
  now: Date,
): boolean {
  const contract = PROJECTION_CONTRACTS[context]
  const ageMs = now.getTime() - lastUpdatedAt.getTime()
  return ageMs > contract.maxStalenessMs
}

/**
 * Determine the freshness label to display to users.
 */
export type FreshnessLabel = 'fresh' | 'stale' | 'degraded' | 'unknown'

export function getFreshnessLabel(
  context: ProjectionContext,
  lastUpdatedAt: Date | null,
  now: Date,
): FreshnessLabel {
  if (!lastUpdatedAt) return 'unknown'
  const contract = PROJECTION_CONTRACTS[context]
  const ageMs = now.getTime() - lastUpdatedAt.getTime()

  if (ageMs <= contract.maxStalenessMs) return 'fresh'
  if (ageMs <= contract.maxStalenessMs * 3) return 'stale'
  return 'degraded'
}

// ── Monotonic version application ──────────────────────────────────

/**
 * Check if an event should be applied to a projection based on
 * monotonic version ordering. Events with a version lower than
 * the last applied version are skipped (prevents out-of-order duplicates).
 */
export function shouldApplyEvent(
  eventVersion: number,
  lastAppliedVersion: number | null,
): boolean {
  if (lastAppliedVersion === null) return true
  return eventVersion > lastAppliedVersion
}

// ── Property-scoped rebuild ────────────────────────────────────────

/**
 * Request a bounded rebuild of a projection for a specific property.
 * The rebuild compares rebuilt state to live state and reports discrepancies.
 */
export type RebuildRequest = Readonly<{
  context: ProjectionContext
  propertyId: string
  /** Start from this event sequence (inclusive). */
  fromSequence: number
  /** End at this event sequence (inclusive). null = to latest. */
  toSequence: number | null
  /** Dry run: compute and report without applying. */
  dryRun: boolean
}>

export type RebuildResult = Readonly<{
  context: ProjectionContext
  propertyId: string
  eventsProcessed: number
  rowsCreated: number
  rowsUpdated: number
  rowsDeleted: number
  discrepanciesFound: number
  durationMs: number
}>
