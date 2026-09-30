// Reporting application — combine Portal readings into one group or total row.
//
// Pure. A group's figures are the sum of its Portals' governed sums; its
// evidence is the weakest of its Portals', family by family, because a figure
// is only as complete as the least complete reading that feeds it. Nothing here
// invents a value: an empty set of Portals is a verified nothing, a set with one
// Portal the pipeline is still processing is "updating" as a whole.

import { METRIC_VERSION_IDS } from '../../domain/metric-registry'
import type {
  MetricPortalMetricEvidence,
  MetricPortalMetricEvidenceSet,
  PortalMetricFamily,
  PortalMetricSumRow,
} from '../ports/portal-analytics.repository'
import type { PortalResultsCell } from '../ports/portal-results-overview.repository'

const FAMILY_VERSION_ID: Readonly<Record<PortalMetricFamily, string>> = {
  scans: METRIC_VERSION_IDS.qualifiedScanGoal,
  privateRatings: METRIC_VERSION_IDS.portalRatingAnalytics,
  privateFeedback: METRIC_VERSION_IDS.portalFeedbackAnalytics,
  reviewLinkClicks: METRIC_VERSION_IDS.portalDestinationClickAnalytics,
}

const FAMILIES = Object.keys(FAMILY_VERSION_ID) as readonly PortalMetricFamily[]

/** How far a state is from serving a figure: the higher, the less that can be said. */
const STATE_SEVERITY: Readonly<Record<MetricPortalMetricEvidence['state'], number>> = {
  ready: 0,
  insufficient: 1,
  updating: 2,
  unavailable: 3,
}

function latest(dates: readonly (Date | null)[]): Date | null {
  return dates.reduce<Date | null>(
    (best, date) => (date && (!best || date > best) ? date : best),
    null,
  )
}

function earliest(dates: readonly Date[]): Date | null {
  return dates.reduce<Date | null>(
    (best, date) => (!best || date < best ? date : best),
    null,
  )
}

function emptyEvidence(family: PortalMetricFamily, computedAt: Date) {
  return {
    definitionVersionId: FAMILY_VERSION_ID[family],
    state: 'ready',
    verifiedThrough: computedAt,
    latestActivity: null,
    computedAt,
    completeness: 1,
    availabilityReason: null,
    correctionHead: null,
  } satisfies MetricPortalMetricEvidence
}

function combineFamily(
  family: PortalMetricFamily,
  items: readonly MetricPortalMetricEvidence[],
  computedAt: Date,
): MetricPortalMetricEvidence {
  const [first, ...rest] = items
  if (!first) return emptyEvidence(family, computedAt)
  // The first of equally weak Portals speaks for the group, so the reason shown
  // is stable for a given roster order.
  const weakest = rest.reduce(
    (worst, item) =>
      STATE_SEVERITY[item.state] > STATE_SEVERITY[worst.state] ? item : worst,
    first,
  )
  return {
    definitionVersionId: FAMILY_VERSION_ID[family],
    state: weakest.state,
    verifiedThrough:
      weakest.state === 'ready'
        ? earliest(
            items.flatMap((item) => (item.verifiedThrough ? [item.verifiedThrough] : [])),
          )
        : null,
    latestActivity: latest(items.map((item) => item.latestActivity)),
    computedAt: latest(items.map((item) => item.computedAt)) ?? computedAt,
    completeness: Math.min(...items.map((item) => item.completeness)),
    availabilityReason: weakest.availabilityReason,
    correctionHead: latest(items.map((item) => item.correctionHead)),
  }
}

/**
 * The evidence for a row made of several Portals. `computedAt` stands in only
 * where there is no Portal to speak for a family (an empty group).
 */
export function combineEvidence(
  sets: readonly MetricPortalMetricEvidenceSet[],
  computedAt: Date,
): MetricPortalMetricEvidenceSet {
  const combined = FAMILIES.map(
    (family) =>
      [
        family,
        combineFamily(
          family,
          sets.map((set) => set[family]),
          computedAt,
        ),
      ] as const,
  )
  return Object.fromEntries(combined) as MetricPortalMetricEvidenceSet
}

/** Add the cells' totals and counts per metric key, in metric key order. */
export function sumCells(cells: readonly PortalResultsCell[]): PortalMetricSumRow[] {
  const sums = new Map<string, { total: number; count: number }>()
  for (const cell of cells) {
    const soFar = sums.get(cell.metricKey) ?? { total: 0, count: 0 }
    sums.set(cell.metricKey, {
      total: soFar.total + cell.total,
      count: soFar.count + cell.count,
    })
  }
  return [...sums.entries()]
    .sort(([left], [right]) => (left < right ? -1 : 1))
    .map(([metricKey, sum]) => ({ metricKey, ...sum }))
}
