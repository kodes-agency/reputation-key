// Portal engagement funnel: qualified scans -> private ratings -> Google opens.
//
// What is drawn, and whether a chart is drawn at all, is decided by
// portalFunnelPresentation. A chart only appears when the steps really narrow;
// when one out-counts the step before it (qualified scans exist only from
// the day the measure began) the readout shows the counts alone with a note, so the shape is
// never asked to say something the data does not.
import { Cell, Funnel, FunnelChart } from 'recharts'
import { ChartContainer, type ChartConfig } from '#/components/ui/chart'
import type { PortalEngagementFunnel } from '#/contexts/reporting/application/public-api'
import { portalFunnelPresentation, type FunnelStage } from './portal-funnel-presentation'

const funnelConfig = {
  qualifiedScans: { label: 'Qualified scans', color: 'var(--chart-1)' },
  ratings: { label: 'Private ratings', color: 'var(--chart-2)' },
  googleOpens: { label: 'Guests who opened Google', color: 'var(--chart-3)' },
} satisfies ChartConfig

function stageCount(stage: FunnelStage): string {
  const noun = stage.actual === 1 ? stage.singular : stage.plural
  return `${stage.actual.toLocaleString('en-US')} ${noun}`
}

function FunnelReadout({
  stages,
  showSwatches,
}: {
  stages: readonly FunnelStage[]
  showSwatches: boolean
}) {
  return (
    <ol className="space-y-1 text-xs">
      {stages.map((stage, index) => (
        <li key={stage.key} className="flex items-center gap-2">
          {showSwatches ? (
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-[2px]"
              style={{ backgroundColor: `var(--color-${stage.key})` }}
            />
          ) : null}
          <span className="text-muted-foreground">{stage.name}</span>
          <span className="ml-auto font-medium tabular-nums">
            {stageCount(stage)}
            {stage.conversion === null ? null : (
              <span className="ml-2 font-normal text-muted-foreground">
                {stage.conversion}% of {stages[index - 1]?.plural}
              </span>
            )}
          </span>
        </li>
      ))}
    </ol>
  )
}

export function EngagementFunnelChart({
  funnel,
  qualifiedScansSince,
  labelledBy,
}: {
  funnel: PortalEngagementFunnel
  qualifiedScansSince: Date
  labelledBy: string
}) {
  const { stages, mode, note } = portalFunnelPresentation(funnel, qualifiedScansSince)

  if (mode === 'empty') {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        No funnel data yet: no qualified scans, ratings or Google opens were recorded in
        this period.
      </p>
    )
  }

  if (mode === 'counts_only') {
    return (
      <div className="space-y-3">
        <FunnelReadout stages={stages} showSwatches={false} />
        {note === null ? null : <p className="text-xs text-muted-foreground">{note}</p>}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <ChartContainer
        config={funnelConfig}
        // The trapezoids carry no in-shape text. The shape is one named graphic;
        // the counts live in the DOM readout below, where screen readers and
        // copy-paste both reach them.
        role="img"
        aria-labelledby={labelledBy}
        className="min-h-[200px] w-full"
      >
        <FunnelChart>
          <Funnel
            dataKey="actual"
            data={stages.map((stage) => ({ ...stage }))}
            isAnimationActive
          >
            {stages.map((stage) => (
              <Cell key={stage.key} fill={`var(--color-${stage.key})`} />
            ))}
          </Funnel>
        </FunnelChart>
      </ChartContainer>
      <FunnelReadout stages={stages} showSwatches />
    </div>
  )
}
