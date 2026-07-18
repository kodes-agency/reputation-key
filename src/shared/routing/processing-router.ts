// BQC-4.2 — ProcessingRouter: the ONE routing decision model.
//
// Phase BQC-4 §4/§4.2 + ADR 0048: resolves (propertyId, workloadClass) to a
// typed ProcessingTarget containing only approved execution references and
// the routing-policy version. Callers never switch on country codes or pick
// queues/regions themselves; jobs cannot choose their own region; nothing
// else may make routing decisions.
//
// Cell model (ADR 0048): 'us' is the only APPROVED processing cell for beta.
// 'europe' is denied until its infrastructure and privacy/data-flow evidence
// pass; 'global' is a denied placeholder, not a cell; 'unresolved' and a
// missing property fail closed. This table mirrors the 4.1 domain predicate
// (contexts/property/domain/processing-routing.ts isRegionProcessable) — the
// predicate stays in the property domain for use-case assertions (defense in
// depth); the shared zone cannot import context domain, so the routing
// decision itself lives here.
//
// Shared zone: drizzle-free, context-free. The property lookup is a PORT
// (loadPropertyRouting) — production wires the property context's drizzle
// adapter (contexts/property/infrastructure/property-routing.adapter.ts);
// tests use a deterministic stub.

/** Property-scoped protected workload classes. Only these route —
 * tenant-cross sweeps (purge, retention, metric refresh) have no property
 * and never route through a cell. */
export type WorkloadClass = 'review.sync' | 'reply.publish' | 'property.import'

/** An approved execution target: cell, queue, provider reference, and the
 * routing-policy version resolved FRESH from the property record. */
export type ProcessingTarget = Readonly<{
  kind: 'target'
  cell: 'us'
  queue: 'default' | 'background'
  /** BQC-4.3: the cell's provider endpoint REFERENCE — a logical identifier
   * (e.g. 'gbp-default'), never a constructed client and never a URL callers
   * could misuse. The composition root maps it to construction config via
   * providerConfigFor; adapters receive their base URL from there alone. */
  provider: string
  routingPolicyVersion: number
  region: 'us'
}>

/** BQC-4.3: provider endpoint construction config for one logical provider
 * reference. Values live ONLY in the composition root's providerConfigFor
 * mapping — this type is the contract adapters are built from. */
export type ProviderEndpoints = Readonly<{
  gbpApiBaseUrl: string
  reviewsApiBaseUrl: string
  notificationsApiBaseUrl: string
  oauthTokenUrl: string
  oauthUserInfoUrl: string
  oauthRevokeUrl: string
}>

export type RoutingBlockedReason =
  | 'region_unresolved'
  | 'region_denied'
  | 'property_missing'

/** A fail-closed routing decision — the work must not execute anywhere. */
export type RoutingBlocked = Readonly<{
  kind: 'blocked'
  reason: RoutingBlockedReason
  region: string | null
}>

export type RoutingDecision = ProcessingTarget | RoutingBlocked

/**
 * Content-free routing envelope stamped on job payloads at enqueue (BQC-4.2
 * §4.2). Telemetry only — the worker re-resolves routing at dispatch and the
 * fresh decision is the authority; a payload region is NEVER accepted only
 * because it is present.
 */
export type RoutingEnvelope = Readonly<{
  propertyId: string
  region: string
  workloadClass: WorkloadClass
  routingPolicyVersion: number
}>

/** The routing facts persisted on the property (migration 0006). */
export type PropertyRoutingRecord = Readonly<{
  processingRegion: string | null
  routingPolicyVersion: number
}>

export type ProcessingRouterDeps = Readonly<{
  /** Port: load the property's persisted routing facts; null when missing. */
  loadPropertyRouting: (propertyId: string) => Promise<PropertyRoutingRecord | null>
  /** The worker's declared cell (env PROCESSING_CELL, default 'us'). */
  cell: string
}>

export type ProcessingRouter = Readonly<{
  resolve: (propertyId: string, workloadClass: WorkloadClass) => Promise<RoutingDecision>
}>

/**
 * Approved cells → their target references (ADR 0048: 'us' only for beta).
 * Widening requires an explicit decision record. A future cell gets its own
 * queue names and provider reference here — the queue/provider MAP lives in
 * the router so callers never construct queue/cell/provider references
 * themselves.
 */
const CELL_TARGETS: Readonly<
  Record<string, Readonly<{ cell: 'us'; region: 'us'; provider: string }>>
> = {
  us: { cell: 'us', region: 'us', provider: 'gbp-default' },
}

/**
 * BQC-4.3: the logical provider reference for an approved cell, or undefined
 * for any non-approved cell (denied/placeholder/unresolved/unknown). The
 * composition root resolves this ONCE into construction config — a cell with
 * no approved provider has nothing to fall back to.
 */
export function providerRefForCell(cell: string): string | undefined {
  return CELL_TARGETS[cell]?.provider
}

/** Workload class → queue. One cell today, so everything lands on 'default';
 * a future background-cell split changes this map only. */
const WORKLOAD_QUEUES: Readonly<Record<WorkloadClass, 'default' | 'background'>> = {
  'review.sync': 'default',
  'reply.publish': 'default',
  'property.import': 'default',
}

/**
 * Job name → workload class for dispatch-time routing. Only property-scoped
 * protected jobs are routed; 'import-property' is an organization-scoped
 * fan-out whose per-property effects ride the sync jobs it spawns, and
 * tenant-cross sweeps never route. String literals mirror the catalogue job
 * names (the shared zone cannot import context job constants); the
 * entry-point catalogue pins those names.
 */
const JOB_WORKLOAD_CLASSES: Readonly<Record<string, WorkloadClass>> = {
  'sync-property-reviews': 'review.sync',
  'publish-reply': 'reply.publish',
}

/** The workload class routed for a job name, or undefined when the job does
 * not route (tenant-cross sweeps, org-scoped fan-outs, unknown jobs). */
export function workloadClassForJob(jobName: string): WorkloadClass | undefined {
  return JOB_WORKLOAD_CLASSES[jobName]
}

/**
 * Create the routing decision model. resolve() loads the property's CURRENT
 * routing facts on every call — a stale allow or a stamped envelope never
 * overrides the fresh decision.
 */
export function createProcessingRouter(deps: ProcessingRouterDeps): ProcessingRouter {
  return {
    resolve: async (propertyId, workloadClass) => {
      const record = await deps.loadPropertyRouting(propertyId)
      if (!record) {
        return { kind: 'blocked', reason: 'property_missing', region: null }
      }
      const region = record.processingRegion
      if (region == null || region === 'unresolved') {
        return { kind: 'blocked', reason: 'region_unresolved', region: region ?? null }
      }
      const target = CELL_TARGETS[region]
      if (!target) {
        return { kind: 'blocked', reason: 'region_denied', region }
      }
      return {
        kind: 'target',
        cell: target.cell,
        region: target.region,
        queue: WORKLOAD_QUEUES[workloadClass],
        provider: target.provider,
        routingPolicyVersion: record.routingPolicyVersion,
      }
    },
  }
}
