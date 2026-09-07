import { Bar, BarChart, XAxis, YAxis } from 'recharts'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '#/components/ui/chart'

const chartConfig = {
  count: { label: 'Count', color: 'var(--chart-1)' },
} satisfies ChartConfig

type Props = Readonly<{
  distribution: readonly { stars: number; count: number }[]
  labelledBy: string
}>

export function RatingDistributionChart({ distribution, labelledBy }: Props) {
  const total = distribution.reduce((sum, bucket) => sum + bucket.count, 0)
  if (total === 0) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        No ratings in this period.
      </p>
    )
  }

  const data = distribution.map((bucket) => ({
    stars: `${bucket.stars}★`,
    count: bucket.count,
  }))

  return (
    <ChartContainer
      config={chartConfig}
      role="img"
      aria-labelledby={labelledBy}
      className="min-h-[200px] w-full"
    >
      <BarChart data={data} margin={{ left: 0, right: 0 }}>
        <XAxis dataKey="stars" tickLine={false} axisLine={false} />
        <YAxis hide />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="count" fill="var(--color-count)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ChartContainer>
  )
}
