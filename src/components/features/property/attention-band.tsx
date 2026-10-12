import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { Clock, Inbox, Target, TrendingDown, TriangleAlert } from 'lucide-react'
import { Badge } from '#/components/ui/badge'
import type { AttentionSignals } from '#/contexts/reporting/application/public-api'

export interface AttentionBandProps {
  readonly signals: AttentionSignals
  readonly propertyId: string
}

// The band's chips are links drawn as Badge tones: `negative` for what is late
// or broken, `warn` for what is waiting. They wear the same tint, edge and ink as
// every other status in the product, and a link badge steps its EDGE under the
// pointer, never its fill: the ink's contrast was measured on that fill
// (`token-contrast.test.ts`), where the red chip's old darker hover fill and its
// fill-grade ink had measured 3.85:1 on the light theme, under 4.5:1 for this
// 14 px label.

// min-h-11 = 44 px: these are the page's most-tapped links and they were 30 px
// tall (docs/plan/dashboard-redesign.md row 13). The icon is sized here, as
// `[&>svg]:size-4`, because Badge sizes its own glyph (`[&>svg]:size-3`, a
// different selector from a `size-4` on the icon itself, which loses to it):
// the same arbitrary variant lets tailwind-merge replace Badge's, and the 14 px
// label keeps the 16 px glyph it always had.
const CHIP_BASE = 'min-h-11 gap-1.5 px-4 py-1 text-sm [&>svg]:size-4'

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
      <Icon className="shrink-0" />
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
      <Badge key="overdue" asChild variant="negative" className={CHIP_BASE}>
        <Link to="/inbox" search={{ propertyId, sourceType: 'review' }}>
          <ChipContent icon={Clock} count={signals.overdue} label="Overdue" />
        </Link>
      </Badge>,
    )
  }

  if (signals.itemsToTriage > 0) {
    chips.push(
      <Badge key="itemsToTriage" asChild variant="warn" className={CHIP_BASE}>
        <Link to="/inbox" search={{ propertyId, queue: 'reply' }}>
          <ChipContent
            icon={Inbox}
            count={signals.itemsToTriage}
            label={signals.itemsToTriage === 1 ? 'item to triage' : 'items to triage'}
          />
        </Link>
      </Badge>,
    )
  }

  if (signals.goalsBehindPace > 0) {
    chips.push(
      <Badge key="goalsBehindPace" asChild variant="warn" className={CHIP_BASE}>
        <Link
          to="/properties/$propertyId/goals"
          params={{ propertyId }}
          search={{ view: 'active' }}
        >
          <ChipContent
            icon={Target}
            count={signals.goalsBehindPace}
            label={
              signals.goalsBehindPace === 1 ? 'goal behind pace' : 'goals behind pace'
            }
          />
        </Link>
      </Badge>,
    )
  }

  if (signals.ratingDrop) {
    chips.push(
      <Badge key="ratingDrop" asChild variant="negative" className={CHIP_BASE}>
        <Link to="/properties/$propertyId/reviews" params={{ propertyId }}>
          <ChipContent icon={TrendingDown} count={null} label="rating dropped" />
        </Link>
      </Badge>,
    )
  }

  if (signals.escalated > 0) {
    chips.push(
      <Badge key="escalated" asChild variant="negative" className={CHIP_BASE}>
        <Link to="/inbox" search={{ propertyId, queue: 'escalated' }}>
          <ChipContent
            icon={TriangleAlert}
            count={signals.escalated}
            label={signals.escalated === 1 ? 'escalated' : 'escalated'}
          />
        </Link>
      </Badge>,
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
