/**
 * Executable MET-01 authority for every production `metric_readings` read
 * outside the Metric bounded context.
 *
 * A direct reader is permitted only when it is either:
 * - a named active projection with an immutable version/consumer/source/
 *   correction/availability contract;
 * - a content-free reconciliation diagnostic.
 *
 * The companion architecture test discovers table reads from source and
 * compares them with this inventory. A new direct reader therefore fails
 * closed until its product posture and contract are reviewed here.
 */

export type ActiveMetricReadAuthority = Readonly<{
  id: string
  source: string
  symbol: string
  context: 'dashboard'
  posture: 'active_versioned_projection'
  contract: Readonly<{
    definitionVersionIds: readonly [string, ...string[]]
    consumers: readonly ('dashboard' | 'portal_analytics')[]
    sourcePolicy: 'immutable_definition_allowlist'
    correction: 'current_append_only_tip'
    availability: 'definition_minimum_sample_signal' | 'per_family_projection_evidence'
  }>
}>

export type DiagnosticMetricReadAuthority = Readonly<{
  id: string
  source: string
  symbol: string
  context: 'identity'
  posture: 'audit_only'
  contract: Readonly<{
    definitionVersions: 'all_retained_for_integrity_audit'
    consumer: 'no_product_metric_consumer'
    sourcePolicy: 'observed_not_aggregated'
    correction: 'full_history_compared_with_original'
    availability: 'explicit_exact_conflict_or_orphan_outcome'
  }>
}>

export type MetricReadingDirectReadAuthority =
  ActiveMetricReadAuthority | DiagnosticMetricReadAuthority

function immutableAuthority<const T extends MetricReadingDirectReadAuthority>(
  entry: T,
): Readonly<T> {
  if ('definitionVersionIds' in entry.contract) {
    Object.freeze(entry.contract.definitionVersionIds)
    Object.freeze(entry.contract.consumers)
  }
  Object.freeze(entry.contract)
  return Object.freeze(entry)
}

const REVIEWED_METRIC_READING_DIRECT_READ_AUTHORITIES = [
  {
    id: 'dashboard.legacy-kpi-projection',
    source: 'src/contexts/dashboard/infrastructure/read-facade.ts',
    symbol: 'readMetricAggregates',
    context: 'dashboard',
    posture: 'active_versioned_projection',
    contract: {
      definitionVersionIds: [
        '11111111-1111-4111-8111-111111111201',
        '11111111-1111-4111-8111-111111111202',
        '11111111-1111-4111-8111-111111111203',
        '11111111-1111-4111-8111-111111111204',
      ],
      consumers: ['portal_analytics'],
      sourcePolicy: 'immutable_definition_allowlist',
      correction: 'current_append_only_tip',
      availability: 'definition_minimum_sample_signal',
    },
  },
  {
    id: 'dashboard.fleet-overview-projection',
    source:
      'src/contexts/dashboard/infrastructure/adapters/fleet-overview-projection.adapter.ts',
    symbol: 'createFleetOverviewProjectionAdapter.read',
    context: 'dashboard',
    posture: 'active_versioned_projection',
    contract: {
      definitionVersionIds: [
        '11111111-1111-4111-8111-111111111201',
        '11111111-1111-4111-8111-111111111203',
        '11111111-1111-4111-8111-111111111205',
      ],
      consumers: ['dashboard', 'portal_analytics'],
      sourcePolicy: 'immutable_definition_allowlist',
      correction: 'current_append_only_tip',
      availability: 'per_family_projection_evidence',
    },
  },
] as const satisfies readonly MetricReadingDirectReadAuthority[]

export const METRIC_READING_DIRECT_READ_AUTHORITIES = Object.freeze(
  REVIEWED_METRIC_READING_DIRECT_READ_AUTHORITIES.map(immutableAuthority),
)

export function metricReadingAuthorityViolations(
  entries: readonly MetricReadingDirectReadAuthority[] = METRIC_READING_DIRECT_READ_AUTHORITIES,
): readonly string[] {
  const violations: string[] = []
  const ids = new Set<string>()
  const sources = new Set<string>()

  for (const entry of entries) {
    if (ids.has(entry.id)) violations.push(`${entry.id}: duplicate authority id`)
    if (sources.has(entry.source)) {
      violations.push(`${entry.source}: duplicate direct-reader source`)
    }
    ids.add(entry.id)
    sources.add(entry.source)

    if (entry.posture === 'active_versioned_projection') {
      if (entry.contract.definitionVersionIds.length === 0) {
        violations.push(`${entry.id}: active projection has no immutable version`)
      }
      if (
        new Set(entry.contract.definitionVersionIds).size !==
        entry.contract.definitionVersionIds.length
      ) {
        violations.push(`${entry.id}: active projection repeats a definition version`)
      }
      if (entry.contract.consumers.length === 0) {
        violations.push(`${entry.id}: active projection has no permitted consumer`)
      }
      continue
    }

    // Audit-only readers have a closed contract and no product consumer.
  }

  return violations
}
