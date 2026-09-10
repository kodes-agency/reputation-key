import { Link } from '@tanstack/react-router'
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '#/components/ui/chart'
import { ASPECT_LABELS, ASPECT_POLARITY_LABELS } from '#/shared/aspect-labels'
import { isAiIssueLabel } from '#/shared/ai-issue-label'
import type {
  AiAspectAggregate,
  AiEmergingIssue,
  AiSentimentDay,
} from '#/contexts/ai/application/public-api'

/**
 * Each row keeps mention volume and rating-weighted impact adjacent, then links
 * to the exact aspect/polarity pair in the inbox for audit.
 */
export function AspectBreakdownList({
  propertyId,
  aspects,
  reviewCount,
  analyzedReviewCount,
  preAspectAnalysisCount,
}: Readonly<{
  propertyId: string
  aspects: readonly AiAspectAggregate[]
  reviewCount: number
  analyzedReviewCount: number
  preAspectAnalysisCount: number
}>) {
  const present = aspects.filter((entry) => entry.mentionCount > 0)
  if (present.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {analyzedReviewCount === 0 && preAspectAnalysisCount > 0
          ? 'These reviews were analysed before aspect analysis existed, so aspect mentions and impact cannot be reported.'
          : 'No aspect mentions in this period yet.'}
      </p>
    )
  }
  const busiest = present.reduce(
    (maximum, entry) => Math.max(maximum, entry.mentionCount),
    1,
  )
  const strongestImpact = present.reduce(
    (maximum, entry) => Math.max(maximum, Math.abs(entry.impact)),
    1,
  )

  return (
    <ul className="flex min-w-0 flex-col gap-2">
      {present.map((entry) => {
        const impact = `${entry.impact >= 0 ? '+' : ''}${entry.impact.toFixed(2)}`
        return (
          <li key={`${entry.aspect}:${entry.polarity}`} className="min-w-0">
            <Link
              to="/inbox"
              search={{
                propertyId,
                aspect: entry.aspect,
                polarity: entry.polarity,
              }}
              className="group block min-w-0 rounded-md px-2 py-2 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="block truncate text-sm font-medium">
                {ASPECT_LABELS[entry.aspect]} · {ASPECT_POLARITY_LABELS[entry.polarity]}
              </span>
              <span className="mt-1.5 grid grid-cols-2 gap-3">
                <span>
                  <span className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Mentions</span>
                    <span className="tabular-nums">{entry.mentionCount}</span>
                  </span>
                  <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-muted">
                    <span
                      className="block h-full rounded-full bg-[var(--chart-1)]"
                      style={{
                        width: `${Math.max(2, (entry.mentionCount / busiest) * 100)}%`,
                      }}
                    />
                  </span>
                </span>
                <span>
                  <span className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Impact</span>
                    <span className="tabular-nums">{impact}</span>
                  </span>
                  <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-muted">
                    <span
                      className={
                        entry.impact < 0
                          ? 'block h-full rounded-full bg-[var(--chart-5)]'
                          : 'block h-full rounded-full bg-[var(--chart-2)]'
                      }
                      style={{
                        width: `${Math.max(
                          2,
                          (Math.abs(entry.impact) / strongestImpact) * 100,
                        )}%`,
                      }}
                    />
                  </span>
                </span>
              </span>
              <span className="sr-only">
                {entry.mentionCount} of {reviewCount} reviews; weighted impact {impact}
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

export function EmergingIssuesList({
  issues,
}: Readonly<{ issues: readonly AiEmergingIssue[] }>) {
  const visible = issues
    .filter(
      (issue) =>
        Number.isSafeInteger(issue.count) &&
        issue.count > 0 &&
        isAiIssueLabel(issue.label),
    )
    .slice(0, 5)
  if (visible.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No emerging issues in this period yet.
      </p>
    )
  }
  return (
    <ul className="flex flex-col gap-2">
      {visible.map((issue) => (
        <li
          key={issue.label}
          className="flex items-center justify-between gap-3 rounded-md bg-background/70 px-3 py-2"
        >
          <span className="min-w-0 truncate text-sm">{issue.label}</span>
          <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
            {issue.count}
            <span className="sr-only"> reviews</span>
          </span>
        </li>
      ))}
    </ul>
  )
}

const sentimentConfig = {
  positive: { label: 'Positive', color: 'var(--chart-2)' },
  neutral: { label: 'Neutral', color: 'var(--chart-3)' },
  mixed: { label: 'Mixed', color: 'var(--chart-4)' },
  negative: { label: 'Negative', color: 'var(--chart-5)' },
} satisfies ChartConfig

/**
 * Stacked by day rather than a single number, because sentiment without a trend
 * is not actionable -- a property can hold a steady average while its negative
 * share doubles.
 */
export function SentimentMixChart({
  sentimentByDay,
}: Readonly<{ sentimentByDay: readonly AiSentimentDay[] }>) {
  if (sentimentByDay.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No analysed reviews in this period yet.
      </p>
    )
  }
  const data = sentimentByDay.map((day) => ({
    date: day.localDate.slice(5),
    positive: day.positive,
    neutral: day.neutral,
    mixed: day.mixed,
    negative: day.negative,
  }))

  return (
    <ChartContainer config={sentimentConfig} className="h-[220px] w-full">
      <BarChart data={data} margin={{ left: 0, right: 0, top: 4 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="date" tickLine={false} axisLine={false} minTickGap={16} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        {/* Worst-news-last so the negative share sits at the top of the stack. */}
        <Bar dataKey="positive" stackId="s" fill="var(--color-positive)" />
        <Bar dataKey="neutral" stackId="s" fill="var(--color-neutral)" />
        <Bar dataKey="mixed" stackId="s" fill="var(--color-mixed)" />
        <Bar dataKey="negative" stackId="s" fill="var(--color-negative)" />
      </BarChart>
    </ChartContainer>
  )
}
