import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { Clock, Inbox, Target, TrendingDown, AlertTriangle } from 'lucide-react'
import { cn } from '#/lib/utils'
import type { AttentionSignals } from '#/contexts/dashboard/application/public-api'

export interface AttentionBandProps {
  readonly signals: AttentionSignals
  readonly propertyId: string
}

type Tone = 'destructive' | 'warning'

const TONE_CLASS: Record<Tone, string> = {
  destructive:
    'border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/15',
  warning:
    'border-amber-500/30 bg-amber-500/10 text-amber-700 hover:bg-amber-500/15 dark:text-amber-400',
}

const CHIP_BASE =
  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium transition-colors'

function ChipContent({
  icon: Icon,
  count,
  label,
}: {
  icon: typeof Clock
  count: number | null
  label: string
}): ReactNode {
  return (
    <>
      <Icon className="size-4 shrink-0" />
      {count !== null && <span className="font-semibold tabular-nums">{count}</span>}
      <span>{label}</span>
    </>
  )
}

/**
 * Compact strip of signal chips showing what needs a manager's attention on a
 * property. Only active signals (count > 0, or the rating-drop flag) render;
 * each chip deep-links into a pre-filtered view. Hidden entirely when calm.
 */
export function AttentionBand({ signals, propertyId }: AttentionBandProps) {
  const chips: ReactNode[] = []

  if (signals.unanswered > 0) {
    chips.push(
      <Link
        key="unanswered"
        to="/inbox"
        search={{ propertyId, sourceType: 'review', tab: 'unaddressed' }}
        className={cn(CHIP_BASE, TONE_CLASS.destructive)}
      >
        <ChipContent
          icon={Clock}
          count={signals.unanswered}
          label={signals.unanswered === 1 ? 'review unanswered' : 'reviews unanswered'}
        />
      </Link>,
    )
  }

  if (signals.newFeedback > 0) {
    chips.push(
      <Link
        key="newFeedback"
        to="/inbox"
        search={{ propertyId, tab: 'unaddressed' }}
        className={cn(CHIP_BASE, TONE_CLASS.warning)}
      >
        <ChipContent
          icon={Inbox}
          count={signals.newFeedback}
          label={signals.newFeedback === 1 ? 'item to triage' : 'items to triage'}
        />
      </Link>,
    )
  }

  if (signals.goalsBehindPace > 0) {
    chips.push(
      <Link
        key="goalsBehindPace"
        to="/properties/$propertyId/goals"
        params={{ propertyId }}
        search={{ view: 'active' }}
        className={cn(CHIP_BASE, TONE_CLASS.warning)}
      >
        <ChipContent
          icon={Target}
          count={signals.goalsBehindPace}
          label={signals.goalsBehindPace === 1 ? 'goal behind pace' : 'goals behind pace'}
        />
      </Link>,
    )
  }

  if (signals.ratingDrop) {
    chips.push(
      <Link
        key="ratingDrop"
        to="/properties/$propertyId/reviews"
        params={{ propertyId }}
        className={cn(CHIP_BASE, TONE_CLASS.destructive)}
      >
        <ChipContent icon={TrendingDown} count={null} label="rating dropped" />
      </Link>,
    )
  }

  if (signals.escalated > 0) {
    chips.push(
      <Link
        key="escalated"
        to="/inbox"
        search={{ propertyId, folder: 'escalated' }}
        className={cn(CHIP_BASE, TONE_CLASS.destructive)}
      >
        <ChipContent
          icon={AlertTriangle}
          count={signals.escalated}
          label={signals.escalated === 1 ? 'escalated' : 'escalated'}
        />
      </Link>,
    )
  }

  if (chips.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Needs attention
      </span>
      {chips}
    </div>
  )
}
