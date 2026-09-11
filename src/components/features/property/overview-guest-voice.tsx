// The Guest voice row of Overview (redesign rows 4, 12).
//
// One sentence and two chips, not a section. The old overview carried two full
// AI blocks — a trend narrative with its coverage line, and a three-panel
// "what guests talk about" with a bar list, an issues list and a 318 × 220 px
// sentiment chart. Both moved to the Guest voice page; what stays on the front
// page is the single most useful thing the analysis produces: what guests are
// praising most and complaining about most, in a line.
//
// Self-fetching and failure-isolated, like the sections it replaces. Unlike
// them it never renders nothing: a property with the capability off gets the
// one line and the action that turns it on, because "AI analysis is available
// and off" is exactly what a week-one manager needs to know (row 12).
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { MessagesSquare } from 'lucide-react'
import type { getPropertyAiAggregatesFn } from '#/contexts/ai/server/property-aggregates'
import type { getPropertyAiTrendFn } from '#/contexts/ai/server/property-trend'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { aiKeys } from '#/shared/queries/query-keys'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { ASPECT_LABELS } from '#/shared/aspect-labels'

export type OverviewGuestVoiceServerFns = Readonly<{
  getTrend: typeof getPropertyAiTrendFn
  getAggregates: typeof getPropertyAiAggregatesFn
}>

type Aggregates = Awaited<ReturnType<typeof getPropertyAiAggregatesFn>>
type ReadyAggregates = Extract<Aggregates, { status: 'ready' }>
type AiAspectAggregate = ReadyAggregates['aspects'][number]

function Row({
  children,
  action,
}: Readonly<{ children: React.ReactNode; action?: React.ReactNode }>) {
  return (
    <section aria-labelledby="overview-guest-voice" className="space-y-3">
      <h2 id="overview-guest-voice" className="text-lg font-semibold tracking-tight">
        Guest voice
      </h2>
      <div className="flex flex-col items-start gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <MessagesSquare
            className="mt-0.5 size-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <div className="min-w-0 space-y-2">{children}</div>
        </div>
        {action}
      </div>
    </section>
  )
}

function ReadMore({ propertyId }: Readonly<{ propertyId: string }>) {
  return (
    <Button asChild variant="outline" size="sm" className="shrink-0">
      <Link to="/properties/$propertyId/guests" params={{ propertyId }}>
        Guest voice
      </Link>
    </Button>
  )
}

function AnalysisOff({ propertyId }: Readonly<{ propertyId: string }>) {
  const { can } = usePermissions()
  const canManage = can('ai.manage')
  return (
    <Row
      action={
        canManage ? (
          <Button asChild size="sm" className="shrink-0">
            <Link to="/settings/ai" search={{ propertyId }}>
              Turn on AI analysis
            </Link>
          </Button>
        ) : undefined
      }
    >
      <p className="text-sm">
        Turn on AI analysis to see what guests praise and complain about.
      </p>
      {canManage ? null : (
        <p className="text-sm text-muted-foreground">
          An account admin can turn it on in Settings → AI &amp; replies.
        </p>
      )}
    </Row>
  )
}

function TopicChip({
  tone,
  entry,
}: Readonly<{ tone: 'praise' | 'complaint'; entry: AiAspectAggregate }>) {
  return (
    <span className="flex items-center gap-1.5">
      <Badge variant={tone === 'praise' ? 'secondary' : 'destructive'}>
        {tone === 'praise' ? 'Praise' : 'Complaints'}
      </Badge>
      {ASPECT_LABELS[entry.aspect]}
      <span className="tabular-nums text-muted-foreground">×{entry.mentionCount}</span>
    </span>
  )
}

function TopicSummary({
  read,
  headline,
  propertyId,
}: Readonly<{
  read: ReadyAggregates
  /** The trend narrative's sentence, when there is one. */
  headline: string | null | undefined
  propertyId: string
}>) {
  const mentioned = read.aspects.filter((entry) => entry.mentionCount > 0)
  const praise = mentioned.find((entry) => entry.polarity === 'positive')
  const complaint = mentioned.find((entry) => entry.polarity === 'negative')

  if (!praise && !complaint) {
    return (
      <Row action={<ReadMore propertyId={propertyId} />}>
        <p className="text-sm">
          {read.analyzedReviewCount === 0
            ? 'No reviews with text have been analysed yet, so there are no topics to report.'
            : 'No topics were mentioned often enough to report yet.'}
        </p>
      </Row>
    )
  }

  return (
    <Row action={<ReadMore propertyId={propertyId} />}>
      {headline === null ? null : <p className="text-sm font-medium">{headline}</p>}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        {praise ? <TopicChip tone="praise" entry={praise} /> : null}
        {complaint ? <TopicChip tone="complaint" entry={complaint} /> : null}
      </div>
    </Row>
  )
}

export function OverviewGuestVoice({
  propertyId,
  serverFns,
}: Readonly<{ propertyId: string; serverFns: OverviewGuestVoiceServerFns }>) {
  const trend = useQuery({
    queryKey: aiKeys.propertyTrend(propertyId),
    queryFn: () => serverFns.getTrend({ data: { propertyId } }),
    staleTime: 60_000,
    retry: false,
  })
  const aggregates = useQuery({
    queryKey: aiKeys.propertyAggregates(propertyId),
    queryFn: () => serverFns.getAggregates({ data: { propertyId } }),
    staleTime: 60_000,
    retry: false,
  })

  if (trend.isPending && aggregates.isPending) {
    return (
      <Row>
        <p className="text-sm text-muted-foreground">Reading what guests said…</p>
      </Row>
    )
  }

  if (trend.isError && aggregates.isError) {
    return (
      <Row>
        <p className="text-sm text-muted-foreground">
          Guest voice is unavailable right now. Everything else on this page is
          unaffected.
        </p>
      </Row>
    )
  }

  const read = aggregates.data
  if (read?.status === 'disabled' || trend.data?.status === 'disabled') {
    return <AnalysisOff propertyId={propertyId} />
  }

  if (read?.status !== 'ready') {
    return (
      <Row action={<ReadMore propertyId={propertyId} />}>
        <p className="text-sm">
          Analysing your reviews. Topics appear as soon as there is enough to say.
        </p>
      </Row>
    )
  }

  return (
    <TopicSummary
      read={read}
      headline={trend.data?.status === 'ready' ? trend.data.report.headline : null}
      propertyId={propertyId}
    />
  )
}
