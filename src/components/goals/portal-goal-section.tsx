// The Portal goals section of the Goals page, below the Google section and apart
// from it (ADR 0068): its title, a line on what the goal counts, the Monthly
// portal goal's card, and two slots, `extras` (the other Portal goals) and
// `footer` (the way to add one). A read on its way keeps the card's room; one
// that failed says so here and holds nothing else back. A view that draws no
// card (the History, or a reader who cannot set goals) shows the slots only, or
// that it has nothing to show.
import type { ReactNode } from 'react'
import { Target } from 'lucide-react'
import type { PortalGoalCardView } from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import { EmptyState } from '#/components/ui/empty-state'
import { RegionError } from '#/components/ui/region-error'
import { SectionTitle } from '#/components/ui/section-title'
import { Skeleton } from '#/components/ui/skeleton'
import { PortalGoalCard } from './portal-goal-card'
import type { PortalGoalCommands } from './portal-goal-card-ready'
import { portalGoalSectionLine } from './portal-goal-words'

/** The section's anchor: a link to the goal lands here (`#portal-goals`). */
const PORTAL_GOALS_SECTION_ID = 'portal-goals'

/** A read as the section draws it: its data, whether it failed, and its "Try again". */
export type PortalGoalRead = Readonly<{
  data: PortalGoalCardView | undefined
  failed: boolean
  retrying: boolean
  retry: () => void
}>

type Props = Readonly<{
  propertyId: string
  /** The card's read; null where no card is drawn. */
  card: PortalGoalRead | null
  canCreatePortal: boolean
  /** What the card sends (Use), handed down by the page. */
  commands: PortalGoalCommands
  extras?: ReactNode
  /** What the section says when neither a card nor `extras` has anything to show. */
  empty?: string
  footer?: ReactNode
}>

/**
 * The room the card takes while it is read, so the read that fills it moves
 * nothing below it. Measured in the compiled stories on 2026-10-18 for the
 * beta's most common card, the no-portal gate with its button: 178px at 320,
 * 375 and 390px, 158px from 640px (its fact takes two lines) and 150px from
 * 768px (the button drops its tap height). The first weeks' card is taller
 * (420px at 320px, 308px from 640px, with three Portals) and the unreadable
 * card shorter (102px). Each term below holds one of those bands and drops out
 * above it.
 */
const PORTAL_GOAL_PENDING_HEIGHT =
  'max(150px, min(158px, calc((768px - 100vw) * 1000)), min(178px, calc((640px - 100vw) * 1000)))'

/** Where the page's anchor lands: below the sticky header. */
const ANCHOR_MARGIN = '6rem'

function Pending() {
  return (
    <Skeleton
      aria-hidden="true"
      data-slot="portal-goal-pending"
      className="rounded-xl"
      style={{ minHeight: PORTAL_GOAL_PENDING_HEIGHT }}
    />
  )
}

function SectionCard({
  card,
  ...props
}: Readonly<{
  card: PortalGoalRead
  propertyId: string
  canCreatePortal: boolean
  commands: PortalGoalCommands
}>) {
  if (card.failed) {
    return (
      <RegionError
        message="The monthly portal goal can’t be read right now."
        onRetry={card.retry}
        retrying={card.retrying}
      />
    )
  }
  if (card.data === undefined) return <Pending />
  return <PortalGoalCard card={card.data} {...props} />
}

export function PortalGoalSection({
  propertyId,
  card,
  canCreatePortal,
  commands,
  extras,
  empty,
  footer,
}: Props) {
  const line = card?.data === undefined ? null : portalGoalSectionLine(card.data)
  return (
    <section
      id={PORTAL_GOALS_SECTION_ID}
      aria-labelledby="portal-goals-title"
      className="flex flex-col gap-4"
      style={{ scrollMarginTop: ANCHOR_MARGIN }}
    >
      <div className="flex flex-col gap-1">
        {/* Focusable, so a link that leads here (`#portal-goals`) can hand it the focus. */}
        <SectionTitle id="portal-goals-title" tabIndex={-1} className="outline-none">
          Portal goals
        </SectionTitle>
        {line === null ? null : <p className="text-sm text-muted-foreground">{line}</p>}
      </div>
      {card === null ? null : (
        <SectionCard
          card={card}
          propertyId={propertyId}
          canCreatePortal={canCreatePortal}
          commands={commands}
        />
      )}
      {extras}
      {empty === undefined ? null : <EmptyState icon={Target} title={empty} />}
      {footer}
    </section>
  )
}
