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
import { AI_CATEGORY_LABELS } from '#/shared/ai-category-labels'
import type {
  AiCategoryCount,
  AiSentimentDay,
} from '#/contexts/ai/application/use-cases/read-property-aggregates'

/**
 * A list, not a chart. The question is "what should I fix?", so the answer has
 * to be clickable: every row is a link into the inbox filtered by that
 * category. A recharts bar cannot carry a link, and nesting one inside an
 * anchor is invalid markup, so the bar is a div whose width is the share.
 */
export function CategoryBreakdownList({
  propertyId,
  categories,
  reviewCount,
}: Readonly<{
  propertyId: string
  categories: readonly AiCategoryCount[]
  reviewCount: number
}>) {
  const present = categories.filter((entry) => entry.count > 0)
  if (present.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No categorised reviews in this period yet.
      </p>
    )
  }
  // Share of the busiest category, so the longest bar always fills the row and
  // the comparison between categories stays readable at any volume.
  const busiest = present[0]?.count ?? 1

  return (
    <ul className="flex min-w-0 flex-col gap-1">
      {present.map((entry) => (
        <li key={entry.category} className="min-w-0">
          <Link
            to="/inbox"
            search={{ propertyId, category: entry.category }}
            className="group flex min-w-0 items-center gap-3 rounded-md px-2 py-1.5 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="w-28 shrink-0 truncate text-sm">
              {AI_CATEGORY_LABELS[entry.category]}
            </span>
            <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
              <span
                className="block h-full rounded-full bg-[var(--chart-1)]"
                style={{ width: `${Math.max(2, (entry.count / busiest) * 100)}%` }}
              />
            </span>
            <span className="w-16 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
              {entry.count}
              <span className="sr-only">
                {' '}
                of {reviewCount} reviews mention {AI_CATEGORY_LABELS[entry.category]}
              </span>
            </span>
          </Link>
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
