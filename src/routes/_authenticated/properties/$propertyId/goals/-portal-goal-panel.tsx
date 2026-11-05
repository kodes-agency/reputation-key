// The Google section's view does not affect this section. Read the card only for
// viewers allowed to set goals. Commands and stale refusals invalidate Portal-goal
// reads, not Google-goal reads.

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
