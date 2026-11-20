// The only way a dashboard chart gets on screen (redesign row 9).
//
// Two heights, nothing else. The survey found five chart heights across two
// pages — 612, 432, 280, 256 and 220 px — because `ChartContainer` defaults to
// `aspect-video` and a caller that forgets to clear it inherits whatever its
// container is wide. A 1088 px-wide rating histogram became 612 px tall that
// way. `ChartFrame` sets the height and clears the aspect, so the default is
// never reachable by omission.
//
// The caption is not decoration: it is the chart's one-line reading, and it is
// also the chart's accessible description, so an assistive-technology user gets
// the same sentence a sighted user reads instead of a bare "chart" label.
import { useId, type ReactNode } from 'react'
import { ChartContainer, type ChartConfig } from '#/components/ui/chart'
import { cn } from '#/lib/utils'

export type ChartFrameSize = 'compact' | 'standard'

/** Heights are fixed, not fluid: the shape of the data decides which. */
const SIZE_CLASS: Readonly<Record<ChartFrameSize, string>> = {
  /** Bar lists and distributions — tall enough to label, short enough to scan. */
  compact: 'aspect-auto h-40 w-full',
  /** Time series. */
  standard: 'aspect-auto h-60 w-full',
}

type Props = Readonly<{
  /** What the chart is, for the accessible name. Not rendered visually — the
   *  surrounding section heading already says it. */
  label: string
  /** The chart's reading, in one line: "3.8 → 3.9 over 6 months · 41 reviews". */
  caption: string
  size?: ChartFrameSize
  config: ChartConfig
  className?: string
  children: React.ComponentProps<typeof ChartContainer>['children']
}>

export function ChartFrame({
  label,
  caption,
  size = 'standard',
  config,
  className,
  children,
}: Props) {
  const captionId = useId()

  return (
    <figure className="min-w-0 space-y-2">
      <figcaption id={captionId} className="text-sm text-muted-foreground">
        {caption}
      </figcaption>
      <ChartContainer
        config={config}
        role="img"
        aria-label={label}
        aria-describedby={captionId}
        className={cn(SIZE_CLASS[size], className)}
      >
        {children}
      </ChartContainer>
    </figure>
  )
}

/**
 * Stand-in for a chart that has too little evidence to draw (fewer than
 * `MIN_CHART_BUCKETS` populated buckets). Says the figures instead of drawing
 * two points as a line.
 */
export function ChartTooThin({ children }: Readonly<{ children: ReactNode }>) {
  return <p className="py-6 text-sm text-muted-foreground">{children}</p>
}
