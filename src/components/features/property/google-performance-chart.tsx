import { useId } from 'react'
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import type { PerformanceSeries } from '#/shared/google-performance-report-contract'
import {
  ChartContainer,
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

const COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
] as const
const numberFormat = new Intl.NumberFormat()

function shortDate(localDate: string): string {
  const [, month, day] = localDate.split('-')
  return `${Number(month)}/${Number(day)}`
}

function buildRows(series: readonly PerformanceSeries[]) {
  const dates = new Set<string>()
  for (const item of series) {
    for (const point of item.points) dates.add(point.localDate)
  }
  return [...dates].sort().map((localDate) => {
    const row: Record<string, string | number | null> = { localDate }
    series.forEach((item, index) => {
      row[`series${index}`] =
        item.points.find((point) => point.localDate === localDate)?.value ?? null
    })
    return row
  })
}

function formatValue(value: number | null): string {
  return value === null ? 'Not returned' : numberFormat.format(value)
}

export function GooglePerformanceChart({
  title,
  description,
  series,
}: Readonly<{
  title: string
  description: string
  series: readonly PerformanceSeries[]
}>) {
  const headingId = useId()
  const descriptionId = useId()
  const rows = buildRows(series)
  const config = Object.fromEntries(
    series.map((item, index) => [
      `series${index}`,
      { label: item.label, color: COLORS[index % COLORS.length] },
    ]),
  ) as ChartConfig

  return (
    <figure
      aria-labelledby={headingId}
      aria-describedby={descriptionId}
      className="min-w-0"
    >
      <Card>
        <CardHeader>
          <CardTitle>
            <h3 id={headingId}>{title}</h3>
          </CardTitle>
          <CardDescription id={descriptionId}>{description}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 px-2 sm:px-6">
          {rows.length === 0 ? (
            <p className="px-4 py-12 text-center text-sm text-muted-foreground">
              Google returned no daily values for this period.
            </p>
          ) : (
            <ChartContainer config={config} className="h-64 w-full">
              <AreaChart
                accessibilityLayer
                data={rows}
                margin={{ left: 4, right: 28, top: 8 }}
              >
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="localDate"
                  axisLine={false}
                  minTickGap={24}
                  tickFormatter={shortDate}
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
                    <ChartTooltipContent labelFormatter={(value) => String(value)} />
                  }
                />
                <ChartLegend content={<ChartLegendContent />} />
                {series.map((item, index) => (
                  <Area
                    key={item.id}
                    connectNulls={false}
                    dataKey={`series${index}`}
                    fill={`var(--color-series${index})`}
                    fillOpacity={0.08}
                    isAnimationActive={false}
                    stroke={`var(--color-series${index})`}
                    strokeWidth={2}
                    type="monotone"
                  />
                ))}
              </AreaChart>
            </ChartContainer>
          )}

          <details
            className="rounded-lg border px-3"
            onToggle={(event) => {
              const summary = event.currentTarget.querySelector('summary')
              if (summary instanceof HTMLElement) summary.focus()
            }}
          >
            <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium">
              View daily values
            </summary>
            <Table>
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
                {rows.map((row) => (
                  <TableRow key={String(row.localDate)}>
                    <TableCell>{String(row.localDate)}</TableCell>
                    {series.map((item, index) => (
                      <TableCell key={item.id} className="text-right tabular-nums">
                        {formatValue(row[`series${index}`] as number | null)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </details>
        </CardContent>
      </Card>
    </figure>
  )
}
