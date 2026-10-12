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
      term: 'Qualified scans',
      meaning: `Visits to the page that our server verified, counted once per guest session in 24 hours. Raw page opens, including bots and refreshes, are not counted. Counted from ${formatLongDate(data.qualifiedScansSince) ?? 'the first recorded day'}.`,
    },
    {
      term: 'Private ratings',
      meaning:
        'Ratings guests left on the page that passed the automatic checks. One rating is one response, not one unique guest.',
    },
    {
      term: 'Average private rating',
      meaning: `The stars added up, over the number of ratings. Shown from ${averageMinSample} ratings. Two averages are compared only when both periods have at least ${comparisonMinSample}.`,
    },
    {
      term: 'Guests who opened Google',
      meaning:
        'Guests who opened the Google review link. Taps on any other link are not counted here.',
    },
    {
      term: 'Private notes',
      meaning: 'Notes guests left for the team, which are not published on Google.',
    },
    {
      term: 'Guests by language',
      meaning:
        'Private ratings counted by the language of the page the guest saw when they rated. The languages are read from the responses themselves, so for a short while after new ratings arrive they can run ahead of the private ratings figure above; the list waits while that figure is updating.',
    },
    {
      term: 'Weeks',
      meaning:
        'Weekly bars start on the first day of the period, not on Monday, so the last week can be shorter. Days follow the property’s own time zone.',
    },
  ]
}

export function PortalResultsAbout({
  data,
  showEvidence,
}: Readonly<{ data: PortalAnalyticsData; showEvidence: boolean }>) {
  const { kpis } = data
  return (
    <details className="group text-sm">
      <summary className="flex min-h-11 cursor-pointer items-center justify-end gap-2 text-muted-foreground hover:text-foreground">
        <span aria-hidden="true" className="transition-transform group-open:rotate-90">
          ›
        </span>
        About these measures
      </summary>
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
              { label: 'Qualified scans', evidence: kpis.scans.evidence },
              { label: 'Private ratings', evidence: kpis.ratings.evidence },
              { label: 'Average private rating', evidence: kpis.avgRating.evidence },
              { label: 'Guests who opened Google', evidence: kpis.googleOpens.evidence },
              { label: 'Private notes', evidence: kpis.feedback.evidence },
            ]}
            timeZone={data.period.timezone}
          />
        ) : null}
        <PortalResponseIntegritySummary summary={data.responseIntegrity} />
      </div>
    </details>
  )
}
