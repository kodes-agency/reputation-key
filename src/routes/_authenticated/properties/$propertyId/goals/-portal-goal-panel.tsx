// The Goals page's Portal goals part: the section with the Monthly portal goal's
// card on the Active view, read from its own query (the loader primes it beside
// the Google section), and the page's other Portal goals in its slots. The card
// is read only for someone who may set the goal; a read that failed says so in
// the section and holds nothing else back. The History view draws no card.
import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { hasFailed, isRetrying } from '#/components/hooks/is-retrying'
import {
  PortalGoalSection,
  type PortalGoalRead,
} from '#/components/goals/portal-goal-section'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { portalGoalCardQuery } from './-portal-goal-queries'

type Props = Readonly<{
  propertyId: string
  view: 'active' | 'history'
  /** The other Portal goals, under the card. */
  extras?: ReactNode
  /** What the section says when it has nothing to show (an empty History). */
  empty?: string
  /** The way to add one, at the section's foot. */
  footer?: ReactNode
}>

export function PortalGoalPanel({ propertyId, view, extras, empty, footer }: Props) {
  const { can } = usePermissions()
  const drawsCard = view === 'active' && can('goal.create')
  const card = useQuery({
    ...portalGoalCardQuery(propertyId),
    enabled: drawsCard,
    retry: false,
  })
  const read: PortalGoalRead | null = drawsCard
    ? {
        data: card.data,
        failed: hasFailed(card),
        retrying: isRetrying(card),
        retry: () => void card.refetch(),
      }
    : null
  return (
    <PortalGoalSection
      propertyId={propertyId}
      card={read}
      canCreatePortal={can('portal.create')}
      extras={extras}
      empty={empty}
      footer={footer}
    />
  )
}
