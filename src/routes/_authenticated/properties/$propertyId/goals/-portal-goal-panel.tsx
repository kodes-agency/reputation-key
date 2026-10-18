// The Goals page's Portal goals part: the section with the Monthly portal goal's
// card, read from its own query (the loader primes it beside the Google
// section), and the page's other Portal goals in its slots. It is the same on
// both of the Google section's views (`?view=` is the Google section's, P-7a).
// The card is read only for someone who may set the goal; a read that failed
// says so in the section and holds nothing else back. The
// card's Use sends the set command, and its other doors open the sheet
// (`-portal-goal-sheet-host.tsx`), which sends the same command or, from a goal
// that has not started, changes it; on a month's first seven days the card's
// check-in sends the change now (Use) or Keep. A set, a change or a Keep (or a
// refusal that means the card is behind) marks every Portal-goal read stale,
// never the Google rating goal's.
import type { ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { hasFailed, isRetrying } from '#/components/hooks/is-retrying'
import type { PortalGoalCommands } from '#/components/goals/portal-goal-card-ready'
import type { PortalGoalSheetCommands } from '#/components/goals/portal-goal-sheet'
import {
  PortalGoalSection,
  type PortalGoalRead,
} from '#/components/goals/portal-goal-section'
import { usePermissions } from '#/shared/hooks/usePermissions'
import {
  markPortalGoalReadsStale,
  portalGoalCardQuery,
  portalGoalCommands,
} from './-portal-goal-queries'
import {
  focusPortalGoalCardTitle,
  portalGoalDoorShown,
  usePortalGoalSheet,
} from './-portal-goal-sheet-host'

type Props = Readonly<{
  propertyId: string
  /** The other Portal goals, under the card, given the monthly goal's Program it leaves out. */
  extras?: (monthlyGoalId: string | null) => ReactNode
  /** The way to add one, at the section's foot. */
  footer?: ReactNode
  /** The way to each month's result and the ended goals, under it. */
  results?: ReactNode
}>

export function PortalGoalPanel({ propertyId, extras, footer, results }: Props) {
  const { can } = usePermissions()
  const queryClient = useQueryClient()
  const drawsCard = can('goal.create')
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
  const set = {
    setMonthlyPortalGoalFn: portalGoalCommands.setMonthlyPortalGoal,
    changeMonthlyPortalGoalNowFn: portalGoalCommands.changeMonthlyPortalGoalNow,
    reviseMonthlyPortalGoalFn: portalGoalCommands.reviseMonthlyPortalGoal,
    onSet: () => markPortalGoalReadsStale(queryClient, propertyId),
    checkIn: {
      changeMonthlyPortalGoalNowFn: portalGoalCommands.changeMonthlyPortalGoalNow,
      keepMonthlyPortalGoalFn: portalGoalCommands.keepMonthlyPortalGoal,
    },
  } satisfies PortalGoalCommands & PortalGoalSheetCommands
  const shown = drawsCard ? card.data : undefined
  const sheet = usePortalGoalSheet({
    propertyId,
    card: shown,
    commands: set,
    focusTitle: focusPortalGoalCardTitle,
    reread: async () => (await card.refetch()).data,
    doorShown: portalGoalDoorShown(shown, can('goal.update'), 'card'),
  })
  const monthlyGoalId = card.data?.state === 'goal' ? card.data.goal.programId : null
  return (
    <>
      <PortalGoalSection
        propertyId={propertyId}
        card={read}
        canCreatePortal={can('portal.create')}
        commands={{ ...set, openSheet: sheet.open }}
        extras={extras?.(drawsCard ? monthlyGoalId : null)}
        footer={footer}
        results={results}
      />
      {sheet.sheet}
    </>
  )
}
