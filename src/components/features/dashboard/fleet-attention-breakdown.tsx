import { AlertTriangle, Clock, Inbox, Target, TrendingDown } from 'lucide-react'
import { Badge } from '#/components/ui/badge'
import type { AttentionSignals } from '#/contexts/dashboard/application/public-api'

type Signal = Readonly<{
  key: string
  icon: typeof Clock
  count: number | null
  label: string
  urgent: boolean
}>

/**
 * The five attention signals behind a fleet row's total, in severity order.
 *
 * `FleetEntry` has always carried `attentionSignals` alongside `totalAttention`,
 * and the row rendered only the sum: "12 needing attention", with no way to tell
 * twelve escalations from twelve stale goals. The two are not remotely the same
 * decision.
 *
 * Deliberately not links. The whole fleet row is already a `<Link>` to the
 * property, and an anchor inside an anchor is invalid HTML that assistive
 * technology reads unpredictably. Per-signal click-through needs the row
 * restructured first; the property dashboard's `AttentionBand` already provides
 * it where the markup allows.
 */
const signalsOf = (signals: AttentionSignals): readonly Signal[] =>
  [
    {
      key: 'escalated',
      icon: AlertTriangle,
      count: signals.escalated,
      label: 'escalated',
      urgent: true,
    },
    {
      key: 'ratingDrop',
      icon: TrendingDown,
      // A flag, not a count — it contributes 1 to the total.
      count: signals.ratingDrop ? null : 0,
      label: 'rating dropped',
      urgent: true,
    },
    {
      key: 'unanswered',
      icon: Clock,
      count: signals.unanswered,
      label: signals.unanswered === 1 ? 'unanswered' : 'unanswered',
      urgent: false,
    },
    {
      key: 'itemsToTriage',
      icon: Inbox,
      count: signals.itemsToTriage,
      label: 'to triage',
      urgent: false,
    },
    {
      key: 'goalsBehindPace',
      icon: Target,
      count: signals.goalsBehindPace,
      label: signals.goalsBehindPace === 1 ? 'goal behind' : 'goals behind',
      urgent: false,
    },
  ].filter((signal) => signal.count === null || signal.count > 0)

export function FleetAttentionBreakdown({
  signals,
  totalAttention,
}: Readonly<{ signals: AttentionSignals; totalAttention: number }>) {
  const active = signalsOf(signals)

  if (active.length === 0) {
    return <Badge variant="secondary">All clear</Badge>
  }

  return (
    <div
      className="flex min-w-0 flex-wrap items-center justify-end gap-1.5"
      // The sum stays available to assistive tech and to anyone scanning for
      // the single number the row used to show.
      aria-label={`${totalAttention} needing attention`}
    >
      {active.map(({ key, icon: Icon, count, label, urgent }) => (
        <Badge
          key={key}
          variant={urgent ? 'destructive' : 'outline'}
          className="gap-1 whitespace-nowrap"
        >
          <Icon aria-hidden="true" className="size-3" />
          {count === null ? label : `${count} ${label}`}
        </Badge>
      ))}
    </div>
  )
}
