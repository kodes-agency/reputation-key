import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { Clock, Inbox, Target, TrendingDown, AlertTriangle } from 'lucide-react'
import { cn } from '#/lib/utils'
import type { AttentionSignals } from '#/contexts/reporting/application/public-api'

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

// min-h-11 = 44 px: these are the page's most-tapped links and they were 30 px
// tall (docs/plan/dashboard-redesign.md row 13).
const CHIP_BASE =
  'inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 py-1 text-sm font-medium transition-colors'

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
  // Inbox work is source-agnostic: the triage chip must open the current open
  // folder across Review and Private Feedback sources. Source-specific chips
  // use `sourceType` only when the signal itself is source-specific.
  const chips: ReactNode[] = []

  if (signals.overdue > 0) {
    chips.push(
      <Link
        key="overdue"
        to="/inbox"
        search={{ propertyId, sourceType: 'review' }}
        className={cn(CHIP_BASE, TONE_CLASS.destructive)}
      >
        <ChipContent icon={Clock} count={signals.overdue} label="Overdue" />
      </Link>,
    )
  }

  if (signals.itemsToTriage > 0) {
    chips.push(
      <Link
        key="itemsToTriage"
        to="/inbox"
        search={{ propertyId, folder: 'open' }}
        className={cn(CHIP_BASE, TONE_CLASS.warning)}
      >
        <ChipContent
          icon={Inbox}
          count={signals.itemsToTriage}
          label={signals.itemsToTriage === 1 ? 'item to triage' : 'items to triage'}
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

  // A row that vanishes when calm reads as a rendering failure on the page
  // whose first job is answering "is anything wrong?" — so it says so
  // (redesign rows 4, 12).
  return (
    <section aria-labelledby="overview-attention" className="space-y-3">
      <h2 id="overview-attention" className="text-lg font-semibold tracking-tight">
        Needs attention
      </h2>
      {chips.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing needs your attention.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">{chips}</div>
      )}
    </section>
  )
}
