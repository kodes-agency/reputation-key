import { Link } from '@tanstack/react-router'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { GlossaryTerm } from '#/components/features/shared/glossary-term'
import type {
  AiPropertyInsightAspect,
  AiPropertyInsightsAllTimeReady,
  AiPropertyInsightsPresetReady,
} from '#/contexts/ai/application/public-api'
import { cn } from '#/lib/utils'
import { ASPECT_LABELS } from '#/shared/aspect-labels'

const VISIBLE_TOPIC_COUNT = 10

type PropertyInsightsEvidence =
  AiPropertyInsightsAllTimeReady | AiPropertyInsightsPresetReady

type TopicRow = {
  aspect: AiPropertyInsightAspect['aspect']
  praise: number
  complaints: number
  impact: number
  mentionDelta: number
  impactDelta: number
}

function signedInteger(value: number): string {
  if (value === 0) return '0'
  return `${value > 0 ? '+' : '−'}${Math.abs(value)}`
}

function signedImpact(value: number): string {
  if (value === 0) return '0.0'
  return `${value > 0 ? '+' : '−'}${Math.abs(value).toFixed(1)}`
}

function rowsByTopic(evidence: PropertyInsightsEvidence): TopicRow[] {
  const topics = new Map<AiPropertyInsightAspect['aspect'], TopicRow>()
  for (const entry of evidence.aspects) {
    const row = topics.get(entry.aspect) ?? {
      aspect: entry.aspect,
      praise: 0,
      complaints: 0,
      impact: 0,
      mentionDelta: 0,
      impactDelta: 0,
    }
    if (entry.polarity === 'positive') row.praise += entry.mentionCount
    if (entry.polarity === 'negative') row.complaints += entry.mentionCount
    row.impact += entry.impact
    if ('comparison' in entry) {
      row.mentionDelta += entry.comparison.mentionCountDelta
      row.impactDelta += entry.comparison.impactDelta
    }
    topics.set(entry.aspect, row)
  }
  return [...topics.values()].sort(
    (left, right) =>
      Math.abs(right.impact) - Math.abs(left.impact) ||
      ASPECT_LABELS[left.aspect].localeCompare(ASPECT_LABELS[right.aspect]),
  )
}

function CountLink({
  propertyId,
  row,
  polarity,
}: Readonly<{
  propertyId: string
  row: TopicRow
  polarity: 'positive' | 'negative'
}>) {
  const count = polarity === 'positive' ? row.praise : row.complaints
  const label = polarity === 'positive' ? 'praise' : 'complaint'
  return (
    <Link
      to="/inbox"
      search={{ propertyId, aspect: row.aspect, polarity }}
      aria-label={`${count} ${label} ${count === 1 ? 'mention' : 'mentions'} for ${ASPECT_LABELS[row.aspect]}; open in inbox`}
      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md px-2 font-medium tabular-nums text-link underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      {count}
    </Link>
  )
}

function ImpactMeter({ value, maximum }: Readonly<{ value: number; maximum: number }>) {
  const width = `${(Math.abs(value) / maximum) * 50}%`
  return (
    <span className="flex min-w-0 items-center gap-3 md:min-w-48">
      <span className="relative block h-2 min-w-24 flex-1 overflow-hidden rounded-full bg-muted">
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-1/2 w-px bg-muted-foreground/50"
        />
        {value === 0 ? null : (
          <span
            aria-hidden="true"
            className={cn(
              'absolute inset-y-0',
              value > 0 ? 'left-1/2 bg-positive' : 'right-1/2 bg-destructive',
            )}
            style={{ width }}
          />
        )}
      </span>
      <span
        className={cn(
          'w-12 shrink-0 text-right font-medium tabular-nums',
          value > 0
            ? 'text-positive'
            : value < 0
              ? 'text-destructive'
              : 'text-foreground',
        )}
      >
        {signedImpact(value)}
      </span>
    </span>
  )
}

function Change({ row }: Readonly<{ row: TopicRow }>) {
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm tabular-nums text-muted-foreground">
      <span>
        {signedInteger(row.mentionDelta)}{' '}
        {Math.abs(row.mentionDelta) === 1 ? 'mention' : 'mentions'}
      </span>
      <span aria-hidden="true">·</span>
      <span>{signedImpact(row.impactDelta)} impact</span>
    </span>
  )
}

function Label({
  label,
  term,
  define,
}: Readonly<{
  label: 'Praise' | 'Complaints' | 'Impact'
  term: 'praise-and-complaints' | 'impact'
  define: boolean
}>) {
  return define ? <GlossaryTerm term={term}>{label}</GlossaryTerm> : label
}

function TopicTable({
  propertyId,
  rows,
  maximum,
  comparisonAvailable,
  defineTerms,
  label,
}: Readonly<{
  propertyId: string
  rows: readonly TopicRow[]
  maximum: number
  comparisonAvailable: boolean
  defineTerms: boolean
  label: string
}>) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <Table aria-label={label} className="block md:table">
        <TableCaption className="sr-only">
          Praise, complaints, impact and period change for each topic.
        </TableCaption>
        <TableHeader className="hidden md:table-header-group">
          <TableRow>
            <TableHead className="pl-4">Topic</TableHead>
            <TableHead className="text-right">
              <Label label="Praise" term="praise-and-complaints" define={defineTerms} />
            </TableHead>
            <TableHead className="text-right">
              <Label
                label="Complaints"
                term="praise-and-complaints"
                define={defineTerms}
              />
            </TableHead>
            <TableHead className="min-w-60">
              <Label label="Impact" term="impact" define={defineTerms} />
            </TableHead>
            {comparisonAvailable ? <TableHead>Change</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody className="block md:table-row-group">
          {rows.map((row, index) => (
            <TableRow
              key={row.aspect}
              className="block p-4 last:border-b-0 md:table-row md:p-0"
            >
              <TableCell className="block p-0 pb-2 font-medium whitespace-normal md:table-cell md:p-2 md:pl-4">
                {ASPECT_LABELS[row.aspect]}
              </TableCell>
              <TableCell className="flex min-h-11 items-center justify-between p-0 md:table-cell md:p-2 md:text-right">
                <span className="text-muted-foreground md:hidden">
                  <Label
                    label="Praise"
                    term="praise-and-complaints"
                    define={defineTerms && index === 0}
                  />
                </span>
                <CountLink propertyId={propertyId} row={row} polarity="positive" />
              </TableCell>
              <TableCell className="flex min-h-11 items-center justify-between p-0 md:table-cell md:p-2 md:text-right">
                <span className="text-muted-foreground md:hidden">
                  <Label
                    label="Complaints"
                    term="praise-and-complaints"
                    define={defineTerms && index === 0}
                  />
                </span>
                <CountLink propertyId={propertyId} row={row} polarity="negative" />
              </TableCell>
              <TableCell className="block min-h-11 p-0 py-2 md:table-cell md:p-2">
                <span className="mb-2 block text-muted-foreground md:hidden">
                  <Label
                    label="Impact"
                    term="impact"
                    define={defineTerms && index === 0}
                  />
                </span>
                <ImpactMeter value={row.impact} maximum={maximum} />
              </TableCell>
              {comparisonAvailable ? (
                <TableCell className="block min-h-11 p-0 pt-2 whitespace-normal md:table-cell md:p-2">
                  <span className="mb-1 block text-muted-foreground md:hidden">
                    Change
                  </span>
                  <Change row={row} />
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

export function PropertyInsightsTopicTable({
  propertyId,
  evidence,
}: Readonly<{ propertyId: string; evidence: PropertyInsightsEvidence }>) {
  if (evidence.aspectEvidenceState === 'predates_aspect_analysis') {
    return (
      <p className="text-sm text-muted-foreground">
        These reviews were not analysed for topics, so topics and impact cannot be
        reported.
      </p>
    )
  }
  if (evidence.aspectEvidenceState === 'not_analyzed') {
    return (
      <p className="text-sm text-muted-foreground">
        There are no analysed reviews with text in this period, so topics and impact
        cannot be reported.
      </p>
    )
  }
  if (evidence.aspectEvidenceState === 'no_mentions' || evidence.aspects.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No topic mentions were identified among the analysed reviews in this period.
      </p>
    )
  }

  const rows = rowsByTopic(evidence)
  const visible = rows.slice(0, VISIBLE_TOPIC_COUNT)
  const additional = rows.slice(VISIBLE_TOPIC_COUNT)
  const maximum = Math.max(1, ...rows.map((row) => Math.abs(row.impact)))
  const comparisonAvailable = evidence.range !== 'all' && !evidence.provisional

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <TopicTable
        propertyId={propertyId}
        rows={visible}
        maximum={maximum}
        comparisonAvailable={comparisonAvailable}
        defineTerms
        label="Topics"
      />
      {additional.length > 0 ? (
        <details className="rounded-lg border px-3">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-link outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Show all topics
          </summary>
          <div className="pb-3">
            <TopicTable
              propertyId={propertyId}
              rows={additional}
              maximum={maximum}
              comparisonAvailable={comparisonAvailable}
              defineTerms={false}
              label="More topics"
            />
          </div>
        </details>
      ) : null}
    </div>
  )
}
