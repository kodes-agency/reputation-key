import type {
  PortalResultsSeries,
  PortalVersionMarker,
} from '#/contexts/reporting/application/public-api'
import { formatNumber } from '#/lib/format'
import { formatDayRange } from './portal-results-window'

/** Update names are kept below the plot, never positioned against a bar. */
export function markerLabel(marker: PortalVersionMarker): string {
  const day = formatDayRange(marker.localDate, marker.localDate)
  return marker.kind === 'rollback'
    ? `v${marker.version} made live again ${day}`
    : `v${marker.version} published ${day}`
}

/** Up to this many bars each prints its count; past it only the tallest does. */
export const COLUMNS_THAT_ALL_PRINT_THEIR_COUNT = 7

export function trendModel(
  series: PortalResultsSeries,
  markers: readonly PortalVersionMarker[],
) {
  const largest = Math.max(0, ...series.buckets.map((bucket) => bucket.scans ?? 0))
  if (largest === 0 || series.buckets.some((bucket) => bucket.scans === null)) return null
  const tallest = series.buckets.findIndex((bucket) => bucket.scans === largest)
  const columns = series.buckets.map((bucket, index) => {
    const scans = bucket.scans ?? 0
    const updated = markers.some((marker) => marker.bucket === bucket.index)
    const weekday = new Intl.DateTimeFormat('en-GB', {
      weekday: 'short',
      timeZone: 'UTC',
    }).format(new Date(`${bucket.startLocalDate}T12:00:00Z`))
    const date = formatDayRange(bucket.startLocalDate, bucket.endLocalDate)
    return {
      ...bucket,
      scans,
      updated,
      height: (scans / largest) * 100,
      countLabel:
        scans > 0 &&
        (series.buckets.length <= COLUMNS_THAT_ALL_PRINT_THEIR_COUNT || index === tallest)
          ? formatNumber(scans)
          : null,
      dateLabel:
        series.bucketDays === 1
          ? weekday
          : formatDayRange(bucket.startLocalDate, bucket.startLocalDate),
      dayLabel:
        series.bucketDays === 1 ? String(Number(bucket.startLocalDate.slice(-2))) : null,
      valueLine: `${series.bucketDays === 1 ? `${weekday} ` : ''}${date} · ${formatNumber(scans)} ${scans === 1 ? 'scan' : 'scans'}${updated ? ' · page updated' : ''}`,
      partial: series.bucketDays === 7 && bucket.days < 7,
    }
  })
  const dates = [...new Set(markers.map((marker) => marker.localDate))].sort()
  const updates =
    dates.length === 0
      ? null
      : `Page updated ${dates
          .slice(0, 3)
          .map((date) => formatDayRange(date, date))
          .join(', ')}${dates.length > 3 ? ` and ${dates.length - 3} more` : ''}`
  const last = columns.at(-1)
  return {
    columns,
    updates,
    partialCaption:
      last?.partial && last.scans > 0
        ? `The dashed bar covers ${last.days} ${last.days === 1 ? 'day' : 'days'}.`
        : null,
  }
}
