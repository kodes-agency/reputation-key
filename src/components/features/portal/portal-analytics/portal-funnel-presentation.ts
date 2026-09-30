// Portal engagement funnel — what to draw, decided as data.
//
// Qualified scans -> private ratings -> Google opens. Qualified scans exist
// only from August 2026 (the day the measure went live), and a guest can rate
// without a counted scan, so a step can legitimately out-count the one before
// it. That is real data, not a rendering bug, and a share of "350%" would read
// as a bug all the same. So the rule is one line: when any step out-counts the
// step before it, show the counts and say why, with no percentages and no
// chart whose shape would imply an ordering the data does not have.

import type { PortalEngagementFunnel } from '#/contexts/reporting/application/public-api'

export type FunnelStageKey = 'qualifiedScans' | 'ratings' | 'googleOpens'

export type FunnelStage = Readonly<{
  key: FunnelStageKey
  name: string
  actual: number
  /** The noun a readout appends so a bare number never stands alone. */
  singular: string
  plural: string
  /** Whole percent of the step before, at most 100. Null when it cannot be stated. */
  conversion: number | null
}>

export type FunnelPresentation = Readonly<{
  stages: readonly FunnelStage[]
  /** `empty`: nothing recorded. `counts_only`: an order inversion. */
  mode: 'chart' | 'counts_only' | 'empty'
  note: string | null
}>

/** When qualified scans began counting; the copy names it, the registry owns it. */
const QUALIFIED_SCANS_SINCE = 'August 2026'

const INVERSION_NOTE = `Qualified scans are counted from ${QUALIFIED_SCANS_SINCE}, and a guest can rate without a counted scan, so a step here is larger than the one before it. Counts are shown without percentages.`

const STAGES: readonly Omit<FunnelStage, 'actual' | 'conversion'>[] = [
  {
    key: 'qualifiedScans',
    name: 'Qualified scans',
    singular: 'qualified scan',
    plural: 'qualified scans',
  },
  {
    key: 'ratings',
    name: 'Private ratings',
    singular: 'private rating',
    plural: 'private ratings',
  },
  {
    key: 'googleOpens',
    name: 'Guests who opened Google',
    singular: 'Google open',
    plural: 'Google opens',
  },
]

function withConversion(
  counts: readonly number[],
  chartable: boolean,
): readonly FunnelStage[] {
  return STAGES.map((stage, index) => {
    const actual = counts[index] ?? 0
    const previous = index === 0 ? null : (counts[index - 1] ?? 0)
    const conversion =
      chartable && previous !== null && previous > 0
        ? Math.round((actual / previous) * 100)
        : null
    return { ...stage, actual, conversion }
  })
}

/** A step exceeds the one before it. */
function hasInversion(counts: readonly number[]): boolean {
  return counts.some((count, index) => index > 0 && count > (counts[index - 1] ?? 0))
}

export function portalFunnelPresentation(
  funnel: PortalEngagementFunnel,
): FunnelPresentation {
  const counts = [funnel.qualifiedScans, funnel.ratings, funnel.googleOpens]
  if (counts.every((count) => count === 0)) {
    return { stages: withConversion(counts, false), mode: 'empty', note: null }
  }
  if (hasInversion(counts)) {
    return {
      stages: withConversion(counts, false),
      mode: 'counts_only',
      note: INVERSION_NOTE,
    }
  }
  return { stages: withConversion(counts, true), mode: 'chart', note: null }
}
