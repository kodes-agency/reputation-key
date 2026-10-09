// Portal results — when a window has no figures, what that means and what to say.
//
// A window with nothing in it is not one thing. A portal that is not live yet
// has nothing to count; a portal with no history has nothing to show; and a live
// portal that had scans in the period before and none now has had its code go
// missing, which is exactly what a manager must notice. Only the first two get
// an empty panel. The third keeps its strip, whose zeros and comparison lines
// are the news, and gains one sentence. Pure, so the wording is pinned by tests.

import type { PortalAnalyticsData } from '#/contexts/reporting/application/public-api'
import { formatNumber } from '#/lib/format'
import { dayCount } from './portal-results-window'

export type EmptyResults =
  /** Not live: there is nothing to count until it is published and its code is out. */
  | Readonly<{ kind: 'draft' }>
  /** Live, quiet now, and busy in the period before: the strip stays, with this line. */
  | Readonly<{ kind: 'quiet'; line: string }>
  /** Nothing to show and nothing known of the period before. */
  | Readonly<{ kind: 'nothing'; title: string; description: string }>

type Counts = PortalAnalyticsData['kpis']

function hasAnyFigure(data: PortalAnalyticsData): boolean {
  const { kpis } = data
  return (
    (kpis.scans.value ?? 0) > 0 ||
    (kpis.feedback.value ?? 0) > 0 ||
    (kpis.googleOpens.value ?? 0) > 0 ||
    kpis.avgRating.sampleCount > 0 ||
    data.responseIntegrity.total > 0
  )
}

function hasPendingState(data: PortalAnalyticsData): boolean {
  const { kpis } = data
  return [kpis.scans, kpis.ratings, kpis.avgRating, kpis.feedback, kpis.googleOpens].some(
    ({ evidence }) =>
      evidence.state === 'updating' || evidence.state === 'temporarily_unavailable',
  )
}

/** Clicks exist but cannot be told apart: an empty page would be a false "no data". */
function hasWithheldGoogleOpens(data: PortalAnalyticsData): boolean {
  return data.kpis.googleOpens.evidence.availabilityReason === 'destination_unattributed'
}

/** What the strip has to show: false only for a window the page would otherwise print as zeros. */
function hasResultsToShow(data: PortalAnalyticsData): boolean {
  return hasAnyFigure(data) || hasPendingState(data) || hasWithheldGoogleOpens(data)
}

function priorOf(kpis: Counts) {
  const prior = (value: number | null | undefined) => value ?? 0
  return {
    scans: prior(kpis.scans.priorValue),
    others:
      prior(kpis.ratings.priorValue) +
      prior(kpis.googleOpens.priorValue) +
      prior(kpis.feedback.priorValue),
  }
}

function windowName(days: PortalAnalyticsData['localDays']): {
  now: string
  before: string
  length: number
} | null {
  if (days === null) return null
  const length = dayCount(days.start, days.end)
  return length === 1
    ? { now: 'on this day', before: 'the day before', length }
    : { now: `in these ${length} days`, before: `the ${length} days before`, length }
}

function quietLine(data: PortalAnalyticsData): string | null {
  const name = windowName(data.localDays)
  if (name === null) return null
  const { scans, others } = priorOf(data.kpis)
  const inPrior = name.length === 1 ? name.before : `in ${name.before}`
  if (scans > 0) {
    return `No scans ${name.now} (${formatNumber(scans)} ${inPrior}). Check the printed code is still in place.`
  }
  if (others > 0) {
    return `Nothing was recorded ${name.now}, but there was activity ${inPrior}. Check the printed code is still in place.`
  }
  return null
}

function nothingRecorded(data: PortalAnalyticsData): EmptyResults {
  const name = windowName(data.localDays)
  if (name === null) {
    return {
      kind: 'nothing',
      title: 'No data yet',
      description: 'Results appear once guests start scanning this portal’s code.',
    }
  }
  return {
    kind: 'nothing',
    title:
      name.length === 1
        ? 'Nothing recorded on this day'
        : `Nothing recorded in these ${name.length} days`,
    description:
      'No scans, ratings or notes in this period. If the code is out already, check it is still in place.',
  }
}

/**
 * Null when there are figures to show. `comparing` is whether the period before
 * was read: without it a quiet window cannot be told from a portal that never
 * had a visitor, and says only what it knows.
 */
export function emptyResults(
  data: PortalAnalyticsData,
  options: Readonly<{ comparing: boolean; isLive: boolean }>,
): EmptyResults | null {
  if (hasResultsToShow(data)) return null
  if (!options.isLive) return { kind: 'draft' }
  const line = options.comparing ? quietLine(data) : null
  return line === null ? nothingRecorded(data) : { kind: 'quiet', line }
}
