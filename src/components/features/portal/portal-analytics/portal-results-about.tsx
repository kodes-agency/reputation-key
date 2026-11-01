import { PORTAL_LINK_TAPS_COUNTED_SINCE } from '#/contexts/reporting/application/public-api'
import { formatDayRange, windowFooter } from './portal-results-window'
import { SectionTitle } from '#/components/ui/section-title'
// "About these measures" (board 07): what each number counts and what it does
// not, in the words the boards use. Beneath the definitions sit the two
// read-outs that say how far to trust the figures: the data status table and the
// response quality checks.
import type { PortalAnalyticsData } from '#/contexts/reporting/application/public-api'
import { PortalMetricEvidenceSummary } from './portal-metric-evidence-summary'
import { PortalResponseIntegritySummary } from './portal-response-integrity-summary'
import { formatLongDate } from '#/lib/format'

type Definition = Readonly<{ term: string; meaning: string }>

function definitions(data: PortalAnalyticsData): readonly Definition[] {
  const { averageMinSample, comparisonMinSample } = data.thresholds
  return [
    {
      term: 'Scans',
      meaning: `A guest who opens the page from your code, checked by our server and counted once a day. Refreshes and bots are left out. Counted from ${formatLongDate(data.qualifiedScansSince) ?? 'the first recorded day'}.`,
    },
    {
      term: 'Ratings',
      meaning:
        'Stars guests gave on the page that passed the automatic checks. One rating is one response, not one unique guest.',
    },
    {
      term: 'Average rating',
      meaning: `The stars added up, over the number of ratings. Shown from ${averageMinSample} ratings. Two averages are compared only when both periods have at least ${comparisonMinSample}.`,
    },
    {
      term: 'Went to Google',
      meaning:
        'Guests who opened your Google review link. We can’t see whether they posted a review.',
    },
    {
      term: 'Private notes',
      meaning: 'Notes guests left for the team, which are not published on Google.',
    },
    {
      term: 'Link taps',
      meaning: `A guest tapping one of your links, counted once per link per visit, before or after rating. Counted from ${data.linkTaps ? formatDayRange(data.linkTaps.countedSince, data.linkTaps.countedSince) : formatDayRange(PORTAL_LINK_TAPS_COUNTED_SINCE, PORTAL_LINK_TAPS_COUNTED_SINCE)}.`,
    },
    { term: 'QR code or NFC tag', meaning: 'Which of your codes a scan came through.' },
    {
      term: 'Busiest times',
      meaning: `From the scans in these days, in the property’s time zone. Shown from ${data.thresholds.busiestMinScans} scans.`,
    },
    {
      term: 'Languages',
      meaning:
        'Ratings counted by the language of the page the guest saw when they rated. The languages are read from the responses themselves, so for a short while after new ratings arrive they can run ahead of the ratings figure above; the list waits while that figure is updating.',
    },
    {
      term: 'Days and weeks',
      meaning:
        'Up to 7 days shows days. A longer range shows weeks that start on its first day, not on Monday, so the last week can be shorter. Days follow the property’s own time zone.',
    },
  ]
}

export function PortalResultsAbout({
  data,
  showEvidence,
}: Readonly<{ data: PortalAnalyticsData; showEvidence: boolean }>) {
  const { kpis } = data
  return (
    <div className="space-y-4 text-sm">
      <SectionTitle>How we count</SectionTitle>
      <p className="text-xs text-muted-foreground">
        {windowFooter(
          data.localDays,
          data.period.timezone,
          data.thresholds.comparisonMinSample,
        )}
      </p>
      <div className="space-y-5 pt-2 pb-2">
        <dl className="grid gap-x-8 gap-y-3 @3xl:grid-cols-2">
          {definitions(data).map(({ term, meaning }) => (
            <div key={term}>
              <dt className="font-medium">{term}</dt>
              <dd className="m-0 text-muted-foreground">{meaning}</dd>
            </div>
          ))}
        </dl>
        {showEvidence ? (
          <PortalMetricEvidenceSummary
            entries={[
              { label: 'Scans', evidence: kpis.scans.evidence },
              { label: 'Ratings', evidence: kpis.ratings.evidence },
              { label: 'Average rating', evidence: kpis.avgRating.evidence },
              { label: 'Went to Google', evidence: kpis.googleOpens.evidence },
              { label: 'Private notes', evidence: kpis.feedback.evidence },
            ]}
            timeZone={data.period.timezone}
          />
        ) : null}
        <PortalResponseIntegritySummary summary={data.responseIntegrity} />
      </div>
    </div>
  )
}
