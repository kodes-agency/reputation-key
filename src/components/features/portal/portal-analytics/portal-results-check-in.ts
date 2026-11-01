import type {
  PortalAnalyticsData,
  PortalCountKPIValue,
} from '#/contexts/reporting/application/public-api'
import type { Tone } from '#/components/ui/tone'
import {
  metricAvailabilityDetail,
  metricEvidenceLine,
} from '#/components/features/dashboard/metric-availability-presentation'
import { formatNumber } from '#/lib/format'
import { starsText } from '#/components/features/property/guest-voice/guest-voice-words'
import { priorName } from './portal-results-cells'
import { quietLine } from './portal-results-empty'
import type { PortalResultsPlace } from './portal-results-place'
import { formatDayRange } from './portal-results-window'

type Card = Readonly<{
  tone: Tone
  answer: string
  hint: string | null
  lines: readonly string[]
}>
const card = (
  answer: string,
  lines: readonly string[],
  hint: string | null = null,
  tone: Tone = 'neutral',
): Card => ({ answer, lines, hint, tone })
const guests = (n: number) => `${formatNumber(n)} ${n === 1 ? 'guest' : 'guests'}`

function change(kpi: PortalCountKPIValue, data: PortalAnalyticsData): string | null {
  if (kpi.value === null || kpi.priorValue === null) return null
  const delta = kpi.value - kpi.priorValue
  return delta === 0
    ? `The same as ${priorName(data)}`
    : `${formatNumber(Math.abs(delta))} ${delta > 0 ? 'more' : 'fewer'} than ${priorName(data)}`
}
function evidence(
  kpi: PortalAnalyticsData['kpis']['scans'],
  data: PortalAnalyticsData,
  subject: 'qualified_scans' | 'ratings' | 'google_opens',
): string {
  const e = kpi.evidence
  return (
    (e.availabilityReason
      ? metricAvailabilityDetail(e.availabilityReason)
      : metricEvidenceLine(
          {
            subject,
            state: e.state,
            dataThrough: e.verifiedThrough,
            reason: e.availabilityReason,
          },
          'en-US',
          data.period.timezone,
        )) ?? 'The figures will appear once counting is complete.'
  )
}
function using(data: PortalAnalyticsData, place?: PortalResultsPlace): Card {
  const scans = data.kpis.scans
  if (place?.scansCounted === false)
    return card(
      'We can’t count scans on this code',
      [
        'This code is older than scan counting. Replace it on Share (it needs reprinting).',
      ],
      null,
      'warn',
    )
  if (
    scans.value === null ||
    scans.evidence.state === 'updating' ||
    scans.evidence.state === 'temporarily_unavailable'
  )
    return card('Scans are updating', [evidence(scans, data, 'qualified_scans')])
  if (scans.value === 0) {
    const quiet = quietLine(data)
    return card(
      'No guests scanned in these days',
      [quiet ?? 'If the code is out already, check it is still in place.'],
      change(scans, data),
      quiet ? 'warn' : 'neutral',
    )
  }
  const nfc = data.scanPatterns?.channels
  const action =
    nfc && nfc.qr === 0 && nfc.nfc === scans.value
      ? 'tapped the NFC tag'
      : 'scanned the code'
  return card(
    `${scans.value >= 10 ? 'Yes, ' : ''}${guests(scans.value)} ${action}`,
    data.localDays === null
      ? ['All time shows the total. Choose a range to see days and weeks.']
      : [],
    change(scans, data),
  )
}
function ratingBand(average: number): Readonly<{ word: string; tone: Tone }> {
  if (average >= 4.5) return { word: 'Yes', tone: 'positive' }
  if (average >= 4) return { word: 'Mostly', tone: 'positive' }
  return average >= 3
    ? { word: 'Mixed', tone: 'warn' }
    : { word: 'Not really', tone: 'negative' }
}
function countStars(
  data: PortalAnalyticsData,
  counted: (row: PortalAnalyticsData['ratingDistribution'][number]) => boolean,
): number {
  return data.ratingDistribution.filter(counted).reduce((sum, row) => sum + row.count, 0)
}
function averageChange(delta: number | null, data: PortalAnalyticsData): string | null {
  if (delta === null) return null
  return Math.abs(delta) < 0.05
    ? `About the same as ${priorName(data)}`
    : `${delta > 0 ? 'Up' : 'Down'} ${Math.abs(delta).toFixed(1)} from ${priorName(data)}`
}
function happy(data: PortalAnalyticsData): Card {
  const { ratings, avgRating } = data.kpis
  if (
    ratings.value === null ||
    ratings.evidence.state === 'updating' ||
    ratings.evidence.state === 'temporarily_unavailable'
  )
    return card('Ratings are updating', [evidence(ratings, data, 'ratings')])
  if (ratings.value === 0)
    return card('No guest rated in these days', [
      'Guests rate on your page after they scan.',
    ])
  if (avgRating.value === null) {
    if (avgRating.evidence.availabilityReason === 'below_minimum_sample')
      return card(`${guests(ratings.value)} rated their visit`, [
        `An average shows from ${data.thresholds.averageMinSample} ratings, so it can’t give one guest’s rating away.`,
      ])
    return card('Ratings are updating', [
      evidence({ ...ratings, evidence: avgRating.evidence }, data, 'ratings'),
    ])
  }
  const average = avgRating.value
  const { word, tone } = ratingBand(average)
  const starsAtLeast4 = (row: Readonly<{ stars: number }>) => row.stars >= 4
  const high = countStars(data, starsAtLeast4)
  const low = countStars(data, (row) => !starsAtLeast4(row))
  const hint = averageChange(avgRating.comparison, data)
  return card(
    `${word}. ${starsText(average)} from ${formatNumber(ratings.value)} ${ratings.value === 1 ? 'rating' : 'ratings'}`,
    [`${guests(high)} gave 4 or 5★.`, `${formatNumber(low)} gave 3★ or less.`],
    hint,
    tone,
  )
}
function google(data: PortalAnalyticsData): Card {
  const opens = data.kpis.googleOpens
  if (
    opens.value === null ||
    opens.evidence.state === 'updating' ||
    opens.evidence.state === 'temporarily_unavailable'
  )
    return card('Google opens are updating', [evidence(opens, data, 'google_opens')])
  if (opens.value === 0)
    return card(
      'No guest went on to Google',
      ['Every guest sees the Google button after they rate.'],
      change(opens, data),
    )
  const funnel = data.engagementFunnel
  const lines: string[] = []
  if (funnel && funnel.ratings > 0 && opens.value <= funnel.ratings) {
    lines.push(
      funnel.ratings >= 20
        ? `That’s ${Math.round((opens.value / funnel.ratings) * 100)}% of the guests who rated.`
        : `${formatNumber(opens.value)} of the ${formatNumber(funnel.ratings)} ${funnel.ratings === 1 ? 'guest' : 'guests'} who rated.`,
    )
  }
  lines.push('We can’t see whether they posted a review.')
  return card(`${guests(opens.value)} went on to Google`, lines, change(opens, data))
}
/** A link's name in the manager's words: a link with no text yet still has one. */
export function portalLinkName(label: string): string {
  return label.trim() === '' ? 'Untitled link' : label
}
function links(data: PortalAnalyticsData): Card | null {
  const taps = data.linkTaps
  if (!taps) return null
  // Taps are read from the same click readings as Google opens.
  const clicks = data.kpis.googleOpens
  if (
    clicks.evidence.state === 'updating' ||
    clicks.evidence.state === 'temporarily_unavailable'
  ) {
    return card('Link taps are updating', [evidence(clicks, data, 'google_opens')])
  }
  const top = taps.rows[0]
  const answer =
    taps.total === 0
      ? 'No taps yet'
      : taps.total >= 5 && top && top.taps * 2 >= taps.total
        ? `Mostly ${portalLinkName(top.label)}`
        : `${formatNumber(taps.total)} ${taps.total === 1 ? 'tap' : 'taps'} on your links`
  const hint =
    data.localDays === null || data.localDays.start < taps.countedSince
      ? `Counted from ${formatDayRange(taps.countedSince, taps.countedSince)}`
      : null
  return card(answer, [], hint)
}
/** Answers use server-provided figures and floors; a withheld figure is never zero. */
export function portalResultsCheckIn(
  data: PortalAnalyticsData,
  place?: PortalResultsPlace,
) {
  const notes = data.kpis.feedback.value
  return {
    using: using(data, place),
    happy: happy(data),
    google: google(data),
    links: links(data),
    notes:
      notes !== null && notes > 0 && data.kpis.feedback.evidence.state === 'ready'
        ? `${guests(notes)} left a private note`
        : null,
  }
}
