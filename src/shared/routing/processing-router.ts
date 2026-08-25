// BQC-4.2 — ProcessingRouter: the ONE routing decision model.
//
// Phase BQC-4 §4/§4.2 + ADR 0048: resolves (propertyId, workloadClass) to a
// typed ProcessingTarget containing only approved execution references and
// the routing-policy version. Callers never switch on country codes or pick
// queues/regions themselves; jobs cannot choose their own region; nothing
// else may make routing decisions.
//
// Cell model: the authoritative catalogue owns cell ids, lifecycle states,
// workloads, provider references, country allocation, and deployment facts.
// A catalogue entry routes only after it transitions to `accepting`; cells in
// `provisioning`, `draining`, or `denied` fail closed. `unresolved`, stale or
// future policy versions, and missing subjects also fail closed. The property
// context retains a processability assertion as defense in depth, while this
// shared router remains the sole execution-target decision model.
//
// Shared zone: drizzle-free, context-free. The property lookup is a PORT
// (loadPropertyRouting) — production wires the property context's drizzle
// adapter (contexts/property/infrastructure/property-routing.adapter.ts);
// tests use a deterministic stub.

import type { ProcessingRegion } from '#/shared/domain/processing-profile'
import {
  DATA_CELL_IDS,
  dataCellById,
  resolvePersistedDataCellId,
  resolveDataCellTarget,
  type DataCellId,
  type DataCellWorkload,
} from '#/shared/domain/data-cell-catalogue'

/** Property-scoped protected workload classes. Only these route —
 * tenant-cross sweeps (purge, retention, metric refresh) have no property
 * and never route through a cell. */
export type WorkloadClass = DataCellWorkload

/** An approved execution target: cell, queue, provider reference, and the
 * routing-policy version resolved FRESH from the property record. */
export type ProcessingTarget = Readonly<{
  kind: 'target'
  /** Stable logical Data Cell id from the persisted Property assignment. */
  cell: DataCellId
  queue: 'default' | 'background'
  /** BQC-4.3: the cell's provider endpoint REFERENCE — a logical identifier
   * (e.g. 'gbp-default'), never a constructed client and never a URL callers
   * could misuse. The composition root maps it to construction config via
   * providerConfigFor; adapters receive their base URL from there alone. */
  provider: string
  routingPolicyVersion: number
  /** The property's immutable Data Cell assignment and residency fact. */
  region: ProcessingRegion
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
  'region_unresolved' | 'region_denied' | 'property_missing'

/** A fail-closed property routing decision. */
export type RoutingBlocked = Readonly<{
  kind: 'blocked'
  reason: RoutingBlockedReason
  region: string | null
}>

export type ImportRoutingBlockedReason =
  RoutingBlockedReason | 'import_item_missing' | 'subject_workload_mismatch'

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

/** Property routing facts during the migration 0089 expand phase. */
export type PropertyRoutingRecord = Readonly<{
  /** Expand-phase canonical assignment. Required after the contract migration. */
  dataCellId?: string | null
  /** Legacy compatibility fact; removed after every row and caller migrate. */
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

/** Known catalogue cells. Executability still depends on each entry's state. */
export const ROUTED_REGIONS: ReadonlySet<string> = new Set(DATA_CELL_IDS)

/**
 * BQC-4.3: the logical provider reference for an approved CELL (not a region),
 * or undefined for any non-approved cell. Google's Business Profile APIs are
 * global, but every Data Cell still has an explicit logical reference. The
 * composition root resolves this ONCE into construction
 * config — a cell with no approved provider has nothing to fall back to.
 */
export function providerRefForCell(cell: string): string | undefined {
  return dataCellById(cell)?.providerRef
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
  const legacyRegion = record.processingRegion
  const region = resolvePersistedDataCellId(
    'dataCellId' in record ? record.dataCellId : undefined,
    legacyRegion,
  )
  if (region == null) {
    return {
      kind: 'blocked',
      reason:
        legacyRegion == null || legacyRegion === 'unresolved'
          ? 'region_unresolved'
          : 'region_denied',
      region: legacyRegion ?? null,
    }
  }
  const cell = dataCellById(region)
  if (
    !cell ||
    record.routingPolicyVersion < 1 ||
    record.routingPolicyVersion > cell.policyVersion
  ) {
    return { kind: 'blocked', reason: 'region_denied', region }
  }
  const resolved = resolveDataCellTarget(region, workloadClass)
  if (resolved.kind === 'blocked') {
    return { kind: 'blocked', reason: 'region_denied', region }
  }
  return {
    kind: 'target',
    cell: resolved.target.cellId,
    region: cell.id as ProcessingRegion,
    queue: resolved.target.queue,
    provider: resolved.target.providerRef,
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
