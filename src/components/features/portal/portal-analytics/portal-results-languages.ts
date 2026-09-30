// Portal results — "Guests by language" (board 07).
//
// Counts PRIVATE RATINGS by the language of the page the guest saw, not scans
// (owner decision 2026-09-30). The server hands over the raw locale tags; here
// they become rows: regional tags fold into their language, each language is
// named in its own script, a tag the catalogue does not know keeps its tag, and
// ratings with no recorded language get their own last line instead of being
// guessed into one.

import type { PortalAnalyticsData } from '#/contexts/reporting/application/public-api'
import { GUEST_LOCALE_METADATA, matchGuestLocale } from '#/shared/domain/guest-locale'

export type ResultsLanguageRow = Readonly<{
  key: string
  label: string
  count: number
  /** Whole percent of every rating counted. */
  percent: number
  /** "68 · 58%" */
  detail: string
  /** Width of the bar, as a percent of the largest row. */
  barPercent: number
}>

export type ResultsLanguages = Readonly<{
  rows: readonly ResultsLanguageRow[]
  caption: string
}>

/** Whether the governed ratings figure is still catching up with the guests' responses. */
export function languagesAreHeldBack(
  ratingsState: PortalAnalyticsData['kpis']['ratings']['evidence']['state'],
): boolean {
  return ratingsState === 'updating' || ratingsState === 'temporarily_unavailable'
}

const UNRECORDED_LABEL = 'Language not recorded'

type Tally = { key: string; label: string; count: number }

function fold(languages: PortalAnalyticsData['ratingLanguages']['languages']): Tally[] {
  const byKey = new Map<string, Tally>()
  for (const { locale, count } of languages) {
    const known = matchGuestLocale(locale)
    const key = known ?? locale.toUpperCase()
    const label = known === null ? key : GUEST_LOCALE_METADATA[known].nativeName
    const tally = byKey.get(key) ?? { key, label, count: 0 }
    byKey.set(key, { ...tally, count: tally.count + count })
  }
  return [...byKey.values()].sort(
    (left, right) => right.count - left.count || left.label.localeCompare(right.label),
  )
}

export function languageRows(
  breakdown: PortalAnalyticsData['ratingLanguages'],
): ResultsLanguages {
  const { total, unrecorded } = breakdown
  if (total === 0) return { rows: [], caption: 'No private ratings in this period.' }

  const tallies: Tally[] = [
    ...fold(breakdown.languages),
    ...(unrecorded > 0
      ? [{ key: 'unrecorded', label: UNRECORDED_LABEL, count: unrecorded }]
      : []),
  ]
  const largest = Math.max(...tallies.map((tally) => tally.count))
  const rows = tallies.map((tally): ResultsLanguageRow => {
    const percent = Math.round((tally.count / total) * 100)
    return {
      ...tally,
      percent,
      detail: `${tally.count.toLocaleString('en-US')} · ${percent}%`,
      barPercent: Math.round((tally.count / largest) * 100),
    }
  })
  const noun = total === 1 ? 'private rating' : 'private ratings'
  return {
    rows,
    caption: `From ${total.toLocaleString('en-US')} ${noun}, by page language.`,
  }
}
