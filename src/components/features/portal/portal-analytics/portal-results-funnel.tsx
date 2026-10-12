// "From scan to Google" (board 07): qualified scans, private ratings and guests
// who opened Google as three bars on one scale, with private notes beside them.
// Whether percentages are printed at all is decided by portalFunnelPresentation:
// when a step out-counts the one before it, the counts stand alone with the
// reason, and no share over 100% is ever shown.
import { Lock } from 'lucide-react'
import type { PortalAnalyticsData } from '#/contexts/reporting/application/public-api'
import { portalFunnelPresentation } from './portal-funnel-presentation'
import { formatNumber } from '#/lib/format'

type Props = Readonly<{
  funnel: NonNullable<PortalAnalyticsData['engagementFunnel']> | null
  qualifiedScansSince: Date
  privateNotes: number | null
  headingId: string
}>

/** One readable sentence about how far guests got, only where the shares are sound. */
function conversionSentence(
  ratingShare: number | null,
  openShare: number | null,
): string | null {
  const parts = [
    ratingShare === null
      ? null
      : `${ratingShare}% of qualified scans led to a private rating.`,
    openShare === null
      ? null
      : `${openShare}% of guests who rated went on to open Google.`,
  ].filter((part) => part !== null)
  return parts.length === 0 ? null : parts.join(' ')
}

export function PortalResultsFunnel({
  funnel,
  qualifiedScansSince,
  privateNotes,
  headingId,
}: Props) {
  if (funnel === null) {
    return (
      <p className="text-sm text-muted-foreground">
        The path from scan to Google appears once every step is counted.
      </p>
    )
  }
  const { stages, mode, note } = portalFunnelPresentation(funnel, qualifiedScansSince)
  if (mode === 'empty') {
    return (
      <p className="text-sm text-muted-foreground">
        No qualified scans, ratings or Google opens were recorded in this period.
      </p>
    )
  }
  const largest = Math.max(...stages.map((stage) => stage.actual))
  const scans = stages[0]?.actual ?? 0
  const shareOfScans = (actual: number) =>
    mode === 'chart' && scans > 0 ? Math.round((actual / scans) * 100) : null
  const sentence =
    mode === 'chart'
      ? conversionSentence(stages[1]?.conversion ?? null, stages[2]?.conversion ?? null)
      : null

  return (
    <div className="space-y-4">
      <div className="grid gap-6 @2xl:grid-cols-[minmax(0,1fr)_auto]">
        <ol aria-labelledby={headingId} className="space-y-4">
          {stages.map((stage, index) => {
            const share = index === 0 ? null : shareOfScans(stage.actual)
            return (
              <li key={stage.key} className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span>{stage.name}</span>
                  <span className="tabular-nums">
                    <span className="font-medium">{formatNumber(stage.actual)}</span>
                    {share === null ? null : (
                      <span className="text-muted-foreground"> · {share}% of scans</span>
                    )}
                  </span>
                </div>
                <div aria-hidden="true" className="h-2.5 rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-foreground/70"
                    style={{
                      width: `${largest === 0 ? 0 : Math.max(1, Math.round((stage.actual / largest) * 100))}%`,
                    }}
                  />
                </div>
              </li>
            )
          })}
        </ol>
        {privateNotes === null ? null : (
          <aside className="border-t pt-4 @2xl:border-t-0 @2xl:border-l @2xl:pt-0 @2xl:pl-6">
            <p className="flex items-center gap-1.5 text-sm">
              <Lock aria-hidden="true" className="size-3.5 text-muted-foreground" />
              Private notes
            </p>
            <p className="mt-1 text-2xl leading-8 font-bold tabular-nums">
              {formatNumber(privateNotes)}
            </p>
            <p className="mt-0.5 max-w-44 text-xs text-muted-foreground">
              Notes guests left for the team, not on Google.
            </p>
          </aside>
        )}
      </div>
      {sentence === null ? null : (
        <p className="text-sm text-muted-foreground">{sentence}</p>
      )}
      {note === null ? null : <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  )
}
