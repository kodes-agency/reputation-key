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
  gbpAccountManagementBaseUrl: string
  gbpPerformanceBaseUrl: string
  reviewsApiBaseUrl: string
  notificationsApiBaseUrl: string
  oauthTokenUrl: string
  oauthJwksUrl: string
  oauthRevokeUrl: string
}>

export type RoutingBlockedReason =
  | 'region_unresolved'
  | 'region_denied'
  | 'property_missing'

/** A fail-closed property routing decision. */
export type RoutingBlocked = Readonly<{
  kind: 'blocked'
  reason: RoutingBlockedReason
  region: string | null
}>

export type ImportRoutingBlockedReason =
  | RoutingBlockedReason
  | 'import_item_missing'
  | 'subject_workload_mismatch'

export type ImportRoutingBlocked = Readonly<{
  kind: 'blocked'
  reason: ImportRoutingBlockedReason
  region: string | null
}>

export type RoutingDecision = ProcessingTarget | RoutingBlocked
export type ImportRoutingDecision = ProcessingTarget | ImportRoutingBlocked
export type ProcessingDecision = RoutingDecision | ImportRoutingDecision

/**
 * Content-free routing envelope stamped on job payloads at enqueue (BQC-4.2
 * §4.2). Telemetry only — the worker re-resolves routing at dispatch and the
 * fresh decision is the authority; a payload region is NEVER accepted only
 * because it is present.
 */
export type ProcessingSubject =
  | Readonly<{ kind: 'property'; propertyId: string }>
  | Readonly<{ kind: 'import_item'; organizationId: string; itemId: string }>

export type RoutingEnvelope = Readonly<{
  subject: ProcessingSubject
  region: string
  workloadClass: WorkloadClass
  routingPolicyVersion: number
}>

/** The routing facts persisted on the property (migration 0006). */
export type PropertyRoutingRecord = Readonly<{
  processingRegion: string | null
  routingPolicyVersion: number
}>

/** Current routing facts for a nonterminal tenant-scoped import item. */
export type ImportItemRoutingRecord = Readonly<{
  processingRegion: string
  routingPolicyVersion: number
}>

export type ProcessingRouterDeps = Readonly<{
  /** Port: load the property's persisted routing facts; null when missing. */
  loadPropertyRouting: (propertyId: string) => Promise<PropertyRoutingRecord | null>
  /** Port: tenant-keyed import-item routing; absent fails import work closed. */
  loadImportItemRouting?: (
    organizationId: string,
    itemId: string,
  ) => Promise<ImportItemRoutingRecord | null>
  /** The worker's declared cell (env PROCESSING_CELL, default 'us'). */
  cell: string
}>

export type ProcessingRouter = Readonly<{
  resolve: {
    (
      subject: Extract<ProcessingSubject, { kind: 'property' }>,
      workloadClass: WorkloadClass,
    ): Promise<RoutingDecision>
    (
      subject: Extract<ProcessingSubject, { kind: 'import_item' }>,
      workloadClass: WorkloadClass,
    ): Promise<ImportRoutingDecision>
    (
      subject: ProcessingSubject,
      workloadClass: WorkloadClass,
    ): Promise<ProcessingDecision>
  }
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
 * Job name → workload class for dispatch-time routing. Import-item work is
 * organization-scoped in policy but still routed through its tenant-keyed
 * immutable item facts; it must never impersonate a Property.
 */
const JOB_WORKLOAD_CLASSES: Readonly<Record<string, WorkloadClass>> = {
  'sync-property-reviews': 'review.sync',
  'publish-reply': 'reply.publish',
  'import-gbp-property-item-v2': 'property.import',
}

/** The workload class routed for a job name, or undefined when it does not route. */
export function workloadClassForJob(jobName: string): WorkloadClass | undefined {
  return JOB_WORKLOAD_CLASSES[jobName]
}

function resolveRecord(
  record: PropertyRoutingRecord | ImportItemRoutingRecord | null,
  missingReason: 'property_missing' | 'import_item_missing',
  workloadClass: WorkloadClass,
): ProcessingDecision {
  if (!record) return { kind: 'blocked', reason: missingReason, region: null }
  const region = record.processingRegion
  if (region == null || region === 'unresolved') {
    return { kind: 'blocked', reason: 'region_unresolved', region: region ?? null }
  }
  const target = CELL_TARGETS[region]
  if (!target) return { kind: 'blocked', reason: 'region_denied', region }
  return {
    kind: 'target',
    cell: target.cell,
    region: target.region,
    queue: WORKLOAD_QUEUES[workloadClass],
    provider: target.provider,
    routingPolicyVersion: record.routingPolicyVersion,
  }
}

/**
 * Create the routing decision model. resolve() loads CURRENT server-owned
 * routing facts on every call — a stale allow or stamped envelope never
 * overrides the fresh decision.
 */
export function createProcessingRouter(deps: ProcessingRouterDeps): ProcessingRouter {
  const resolve = async (
    subject: ProcessingSubject,
    workloadClass: WorkloadClass,
  ): Promise<ProcessingDecision> => {
    if (subject.kind === 'property') {
      return resolveRecord(
        await deps.loadPropertyRouting(subject.propertyId),
        'property_missing',
        workloadClass,
      )
    }
    if (workloadClass !== 'property.import') {
      return {
        kind: 'blocked',
        reason: 'subject_workload_mismatch',
        region: null,
      }
    }
    const record = deps.loadImportItemRouting
      ? await deps.loadImportItemRouting(subject.organizationId, subject.itemId)
      : null
    return resolveRecord(record, 'import_item_missing', workloadClass)
  }
  return { resolve: resolve as ProcessingRouter['resolve'] }
}
