// A live Portal whose code predates scan counting has scans nobody counted. The
// read still answers for it, with a zero, and a zero is a number: the rule of this
// table is "a dash with its reason, never a zero that was not counted". These turn
// that Portal's figure into the dash, take it out of the scans sort (no figure sorts
// last, as one still processing does) and say so. Group and Property figures are
// sums, to which a zero adds nothing, so they stand; the note under the strip says
// that some scans are missing from them.
import type { PortalOverviewRow } from '#/contexts/portal/application/public-api'
import { DASH } from '../portal-analytics/portal-results-cells'
import { hasUncountedScans } from './portal-attention'
import {
  measureSlot,
  type MeasureFigure,
  type MeasureSlot,
  type OverviewSortFigures,
  type PortalOverviewResultsState,
  type RowMeasures,
} from './portal-overview-results'

export const SCANS_NOT_COUNTED_REASON = 'Not counted: older code'

/**
 * `withheld`, not `missing`: the figure is held back on purpose, and the reason
 * is one to read (a dash that is merely still processing has none to give).
 */
const NOT_COUNTED: MeasureFigure = {
  text: DASH,
  unit: null,
  tone: 'withheld',
  reason: SCANS_NOT_COUNTED_REASON,
}

/** The row's figures with its scans as a dash; its card has no summary to print ("0 qualified scans"). */
export function withScansNotCounted(measures: RowMeasures): RowMeasures {
  return { ...measures, scans: NOT_COUNTED, summary: null }
}

/** One Portal's measure cells: as the read has them, except scans nobody counted. */
export function portalMeasureSlot(
  state: PortalOverviewResultsState,
  row: Pick<PortalOverviewRow, 'portalId' | 'publicationState' | 'token'>,
): MeasureSlot {
  const slot = measureSlot(state, (index) => index.portal(row.portalId))
  return slot.kind === 'figures' && hasUncountedScans(row)
    ? { kind: 'figures', measures: withScansNotCounted(slot.measures) }
    : slot
}

/** The scans sort, with no figure for a Portal whose scans were not counted. */
export function sortFiguresWithoutUncounted<T extends OverviewSortFigures>(
  figures: T | undefined,
  rows: readonly Pick<PortalOverviewRow, 'portalId' | 'publicationState' | 'token'>[],
): T | undefined {
  if (figures === undefined) return undefined
  const uncounted = new Set<string>(
    rows.filter(hasUncountedScans).map((row) => row.portalId),
  )
  if (uncounted.size === 0) return figures
  return {
    ...figures,
    portal: (portalId: string) =>
      uncounted.has(portalId) ? null : figures.portal(portalId),
  }
}
