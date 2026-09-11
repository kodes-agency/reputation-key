import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import type { PerformanceSeries } from '#/shared/google-performance-report-contract'
import {
  bucketUnitForRange,
  type BucketUnit,
  type DashboardRange,
} from '#/shared/dashboard-range'
import { axisTicks, groupByBucket, hasEnoughEvidence } from '#/shared/chart-buckets'
import {
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '#/components/ui/chart'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { ChartFrame, ChartTooThin } from '#/components/features/shared/chart-frame'

const COLORS = [
  'var(--foreground)',
  'color-mix(in oklab, var(--foreground) 76%, var(--background))',
  'color-mix(in oklab, var(--foreground) 58%, var(--background))',
  'color-mix(in oklab, var(--foreground) 42%, var(--background))',
  'color-mix(in oklab, var(--foreground) 28%, var(--background))',
] as const
const DASH_PATTERNS = [undefined, '9 3', '3 3', '10 3 2 3', '1 4'] as const
const numberFormat = new Intl.NumberFormat()

type DailyRow = {
  localDate: string
  [key: string]: string | number | null
}

type BucketRow = {
  start: string
  label: string
  [key: string]: string | number | null
}

function buildDailyRows(series: readonly PerformanceSeries[]): DailyRow[] {
  const byDate = new Map<string, DailyRow>()
  series.forEach((item, index) => {
    for (const point of item.points) {
      const row = byDate.get(point.localDate) ?? { localDate: point.localDate }
      row[`series${index}`] = point.value
      byDate.set(point.localDate, row)
    }
  })

  const rows = [...byDate.values()].sort((left, right) =>
    left.localDate.localeCompare(right.localDate),
  )
  for (const row of rows) {
    series.forEach((_, index) => {
      row[`series${index}`] ??= null
    })
  }
  return rows
}

function bucketNoun(unit: BucketUnit, count: number): string {
  const noun = unit === 'day' ? 'day' : unit === 'week' ? 'week' : 'month'
  return count === 1 ? noun : `${noun}s`
}

export function buildGooglePerformanceChartModel(
  series: readonly PerformanceSeries[],
  range: DashboardRange,
  valueLabel: string,
) {
  const dailyRows = buildDailyRows(series)
  const unit = bucketUnitForRange(range)
  const buckets = groupByBucket(dailyRows, unit, (row) => row.localDate)
  const rows: BucketRow[] = buckets.map((bucket) => {
    const row: BucketRow = { start: bucket.start, label: bucket.label }
    series.forEach((_, index) => {
      let total = 0
      let complete = bucket.rows.length > 0
      for (const item of bucket.rows) {
        const value = item[`series${index}`]
        if (typeof value !== 'number') {
          complete = false
          break
        }
        total += value
      }
      row[`series${index}`] = complete ? total : null
    })
    return row
  })
  const evidenceBuckets = buckets.map((bucket, index) => ({
    ...bucket,
    rows: series.some(
      (_, seriesIndex) => typeof rows[index]?.[`series${seriesIndex}`] === 'number',
    )
      ? bucket.rows
      : [],
  }))
  const populatedBucketCount = evidenceBuckets.filter(
    (bucket) => bucket.rows.length > 0,
  ).length
  const total = rows.reduce(
    (chartTotal, row) =>
      chartTotal +
      series.reduce((rowTotal, _, index) => {
        const value = row[`series${index}`]
        return rowTotal + (typeof value === 'number' ? value : 0)
      }, 0),
    0,
  )
  const hasMissingValues = rows.some((row) =>
    series.some((_, index) => row[`series${index}`] === null),
  )
  const caption = `${numberFormat.format(total)} ${valueLabel} across ${populatedBucketCount} ${bucketNoun(unit, populatedBucketCount)}${hasMissingValues ? '; unavailable values remain gaps' : ''}.`

  return Object.freeze({
    dailyRows,
    unit,
    buckets,
    rows,
    ticks: axisTicks(buckets),
    labels: Object.freeze(
      Object.fromEntries(buckets.map((bucket) => [bucket.start, bucket.label])),
    ),
    hasEnoughEvidence: hasEnoughEvidence(evidenceBuckets),
    populatedBucketCount,
    total,
    caption,
  })
}

export function GooglePerformanceChart({
  title,
  description,
  valueLabel,
  range,
  series,
}: Readonly<{
  title: string
  description: string
  valueLabel: string
  range: DashboardRange
  series: readonly PerformanceSeries[]
}>) {
  const model = buildGooglePerformanceChartModel(series, range, valueLabel)
  const config = Object.fromEntries(
    series.map((item, index) => [
      `series${index}`,
      { label: item.label, color: COLORS[index % COLORS.length] },
    ]),
  ) as ChartConfig

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-4 px-2 sm:px-6">
        {model.populatedBucketCount === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-muted-foreground">
            Google returned no daily values for this period.
          </p>
        ) : model.hasEnoughEvidence ? (
          <ChartFrame
            label={title}
            caption={model.caption}
            size="standard"
            config={config}
          >
            <AreaChart
              accessibilityLayer
              data={model.rows}
              margin={{ left: 4, right: 28, top: 8 }}
            >
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="start"
                axisLine={false}
                ticks={model.ticks}
                tickFormatter={(value: string) => model.labels[value] ?? value}
                tickLine={false}
                tickMargin={8}
              />
              <YAxis
                allowDecimals={false}
                axisLine={false}
                tickFormatter={(value: number) => numberFormat.format(value)}
                tickLine={false}
                width={48}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(value) =>
                      model.labels[String(value)] ?? String(value)
                    }
                  />
                }
              />
              {series.length > 1 ? (
                <ChartLegend content={<ChartLegendContent />} />
              ) : null}
              {series.map((item, index) => (
                <Area
                  key={item.id}
                  connectNulls={false}
                  dataKey={`series${index}`}
                  fill={`var(--color-series${index})`}
                  fillOpacity={0.06}
                  isAnimationActive={false}
                  stroke={`var(--color-series${index})`}
                  strokeDasharray={DASH_PATTERNS[index % DASH_PATTERNS.length]}
                  strokeWidth={2}
                  type="monotone"
                />
              ))}
            </AreaChart>
          </ChartFrame>
        ) : (
          <ChartTooThin>
            Google returned {model.populatedBucketCount}{' '}
            {bucketNoun(model.unit, model.populatedBucketCount)} with values, too little
            to show a trend. {numberFormat.format(model.total)} {valueLabel} were
            reported.
          </ChartTooThin>
        )}

        <details
          className="min-w-0 max-w-full overflow-hidden rounded-lg border px-3"
          onToggle={(event) => {
            const summary = event.currentTarget.querySelector('summary')
            if (summary instanceof HTMLElement) summary.focus()
          }}
        >
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium">
            View daily values
          </summary>
          <Table className="min-w-max">
            <TableCaption>{title} daily values in property-local dates.</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                {series.map((item) => (
                  <TableHead key={item.id} className="text-right">
                    {item.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {model.dailyRows.map((row) => (
                <TableRow key={row.localDate}>
                  <TableCell>{row.localDate}</TableCell>
                  {series.map((item, index) => (
                    <TableCell key={item.id} className="text-right tabular-nums">
                      {row[`series${index}`] === null
                        ? 'Not returned'
                        : numberFormat.format(row[`series${index}`] as number)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </details>
      </CardContent>
    </Card>
  )
}
