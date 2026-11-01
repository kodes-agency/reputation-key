import { formatNumber } from '#/lib/format'
import type { PortalResultsMeasures } from '#/contexts/reporting/application/public-api'
import type { RowMeasures, MeasureFigure } from './portal-overview-results'
/** A synthetic section totals only its own current members; unknown inputs stay unknown. */
export function staffSectionMeasures(
  rows: readonly PortalResultsMeasures[],
): RowMeasures | null {
  if (!rows.length) return null
  const figure = (values: readonly (number | null)[], average = false): MeasureFigure =>
    values.some((value) => value === null)
      ? {
          text: '—',
          unit: null,
          tone: 'missing',
          reason: 'Some figures are not available.',
        }
      : {
          text: formatNumber(
            values.reduce<number>((sum, value) => sum + value!, 0),
            average ? { maximumFractionDigits: 1 } : {},
          ),
          unit: average ? 'star' : null,
          tone: 'figure',
          reason: null,
        }
  const ratings = rows.reduce((sum, row) => sum + (row.kpis.ratings.value ?? 0), 0)
  const averageKnown = rows.every(
    (row) =>
      row.kpis.ratings.value !== null &&
      (row.kpis.ratings.value === 0 || row.kpis.avgRating.value !== null),
  )
  const average =
    ratings >= 5 && averageKnown
      ? rows.reduce(
          (sum, row) =>
            sum + (row.kpis.avgRating.value ?? 0) * (row.kpis.ratings.value ?? 0),
          0,
        ) / ratings
      : null
  return {
    scans: figure(rows.map((row) => row.kpis.scans.value)),
    ratings: figure(rows.map((row) => row.kpis.ratings.value)),
    average: figure([average], true),
    googleOpens: figure(rows.map((row) => row.kpis.googleOpens.value)),
    notes: figure(rows.map((row) => row.kpis.feedback.value)),
    summary: null,
  }
}
