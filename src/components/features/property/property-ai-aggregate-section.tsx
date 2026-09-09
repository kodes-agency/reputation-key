import { useQuery } from '@tanstack/react-query'
import type { getPropertyAiAggregatesFn } from '#/contexts/ai/server/property-aggregates'
import { aiKeys } from '#/shared/queries/query-keys'
import {
  AspectBreakdownList,
  EmergingIssuesList,
  SentimentMixChart,
} from './property-ai-aggregate-charts'

export type PropertyAiAggregatesServerFn = typeof getPropertyAiAggregatesFn

function Section({
  children,
}: Readonly<{ children: React.ReactNode }>): React.ReactElement {
  return (
    <section aria-labelledby="guest-topics-heading" className="min-w-0">
      <h2
        id="guest-topics-heading"
        className="text-sm font-medium uppercase tracking-wide text-muted-foreground"
      >
        What guests talk about
      </h2>
      {children}
    </section>
  )
}

/**
 * Self-fetching and failure-isolated, matching `PropertyAiTrendSection`: this
 * data is behind a merchant AI capability that most tenants do not have, and a
 * denial or an outage here must not take the rest of the dashboard down.
 * A tenant without the capability sees nothing at all - see the final guard
 * below for why that is deliberate rather than an oversight.
 */
export function PropertyAiAggregateSection({
  propertyId,
  getAggregates,
}: Readonly<{
  propertyId: string
  getAggregates: PropertyAiAggregatesServerFn
}>) {
  const aggregates = useQuery({
    queryKey: aiKeys.propertyAggregates(propertyId),
    queryFn: () => getAggregates({ data: { propertyId } }),
    staleTime: 60_000,
    retry: false,
  })

  if (aggregates.isPending) return null

  if (aggregates.isError) {
    return (
      <Section>
        <div className="mt-3 rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">
            Guest insights are unavailable right now. The rest of the dashboard is
            unaffected.
          </p>
        </div>
      </Section>
    )
  }

  if (aggregates.data?.status === 'preparing') {
    return (
      <Section>
        <div className="mt-3 rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">
            Analysis for this property is still settling. Insights appear once the daily
            totals agree with the reviews behind them.
          </p>
        </div>
      </Section>
    )
  }

  // Everything that is not `ready` and not `preparing` renders nothing at all.
  // That is chiefly `disabled`, and it is deliberate: the capability gate stays
  // invisible to a tenant who was never granted it, rather than advertising a
  // feature they cannot use. Matches PropertyAiTrendSection.
  if (aggregates.data?.status !== 'ready') return null
  const data = aggregates.data

  return (
    <Section>
      <p className="mt-1 text-xs text-muted-foreground">
        {data.reviewCount} analysed {data.reviewCount === 1 ? 'review' : 'reviews'} from{' '}
        {data.startLocalDate} to {data.endLocalDate}, in the property&apos;s own time zone
      </p>
      <div className="mt-3 grid min-w-0 gap-4 xl:grid-cols-3">
        <div className="min-w-0 rounded-lg border bg-muted/30 p-4">
          <h3 className="mb-1 text-sm font-semibold tracking-tight">
            Aspect mentions and impact
          </h3>
          <p className="mb-3 text-xs text-muted-foreground">
            Mention counts beside rating-weighted impact
          </p>
          <AspectBreakdownList
            propertyId={propertyId}
            aspects={data.aspects}
            reviewCount={data.reviewCount}
          />
        </div>
        <div className="min-w-0 rounded-lg border bg-muted/30 p-4">
          <h3 className="mb-3 text-sm font-semibold tracking-tight">Emerging issues</h3>
          <EmergingIssuesList issues={data.emergingIssues} />
        </div>
        <div className="min-w-0 rounded-lg border bg-muted/30 p-4">
          <h3 className="mb-3 text-sm font-semibold tracking-tight">
            Sentiment over time
          </h3>
          <SentimentMixChart sentimentByDay={data.sentimentByDay} />
        </div>
      </div>
    </Section>
  )
}
