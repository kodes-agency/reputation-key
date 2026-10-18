// The Property Overview's Monthly portal goal (PLAN PG-16): the Goals page
// card's own read (the Overview's loader primes it beside the Google rating
// goal), drawn in the Overview's slot as `overviewPortalGoalView` says. It is
// read only for someone who may set the goal; a read that fails leaves the slot
// empty, never the Overview in an error. "Not now" hides the prompt at once
// (the card's read is written as the server will answer it, and put back with
// a toast when the command fails), then marks every Portal-goal read stale. On
// the month's first seven days the check-in sends the change now (Use) or Keep,
// and "Other number" opens the change sheet; once answered, the slot's title
// takes the focus.
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { PortalGoalCardView } from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import { withGoalRefusals } from '#/components/goals/goal-refusal'
import {
  PORTAL_GOAL_OVERVIEW_TITLE_ID,
  PortalGoalOverview,
} from '#/components/goals/portal-goal-overview'
import { overviewPortalGoalView } from '#/components/goals/portal-goal-overview-view'
import type { PortalGoalSheetCommands } from '#/components/goals/portal-goal-sheet'
import {
  actionErrorMessage,
  useActionMutation,
} from '#/components/hooks/use-action-mutation'
import { useCapabilities } from '#/shared/hooks/useCapabilities'
import { usePermissions } from '#/shared/hooks/usePermissions'
import {
  deferPortalGoalPrompt,
  markPortalGoalReadsStale,
  portalGoalCardQuery,
  portalGoalCommands,
} from './-portal-goal-queries'
import { usePortalGoalSheet } from './-portal-goal-sheet-host'

const focusTitle = (): void =>
  document.getElementById(PORTAL_GOAL_OVERVIEW_TITLE_ID)?.focus()

/**
 * The card's read with the prompt for `month` put off, as the server answers
 * once "Not now" is saved; the thunk puts back what was there.
 */
function putOff(
  queryClient: QueryClient,
  propertyId: string,
  month: string,
): (() => void) | undefined {
  const { queryKey } = portalGoalCardQuery(propertyId)
  const read = queryClient.getQueryData(queryKey)
  if (read === undefined || !('prompt' in read) || read.prompt.month !== month) {
    return undefined
  }
  const putOffRead: PortalGoalCardView = {
    ...read,
    prompt: { ...read.prompt, deferred: true },
  }
  queryClient.setQueryData(queryKey, putOffRead)
  return () => queryClient.setQueryData(queryKey, read)
}

export function OverviewPortalGoal({ propertyId }: Readonly<{ propertyId: string }>) {
  const { can } = usePermissions()
  const { has } = useCapabilities()
  const queryClient = useQueryClient()
  const canSet = can('goal.create') && has('goal.use')
  const card = useQuery({
    ...portalGoalCardQuery(propertyId),
    enabled: canSet,
    retry: false,
  })
  const shown = canSet ? card.data : undefined
  const view = overviewPortalGoalView({
    card: shown,
    canSet,
    canChange: can('goal.update'),
  })
  const markStale = () => markPortalGoalReadsStale(queryClient, propertyId)
  const notNow = useActionMutation(withGoalRefusals(deferPortalGoalPrompt), {
    optimistic: ({ data }) => putOff(queryClient, propertyId, data.month),
    onSuccess: markStale,
    errorMessage: actionErrorMessage,
  })
  const commands = {
    setMonthlyPortalGoalFn: portalGoalCommands.setMonthlyPortalGoal,
    changeMonthlyPortalGoalNowFn: portalGoalCommands.changeMonthlyPortalGoalNow,
    reviseMonthlyPortalGoalFn: portalGoalCommands.reviseMonthlyPortalGoal,
    onSet: markStale,
  } satisfies PortalGoalSheetCommands
  const sheet = usePortalGoalSheet({
    propertyId,
    card: shown,
    commands,
    focusTitle,
    reread: async () => (await card.refetch()).data,
    // The check-in's "Other number" is the slot's one door to the sheet.
    doorShown: view.kind === 'check_in',
  })
  return (
    <>
      <PortalGoalOverview
        view={view}
        propertyId={propertyId}
        onNotNow={(month) =>
          void notNow({ data: { propertyId, month } }).catch(() => undefined)
        }
        notNowPending={notNow.isPending}
        checkIn={{
          commands: {
            changeMonthlyPortalGoalNowFn: portalGoalCommands.changeMonthlyPortalGoalNow,
            keepMonthlyPortalGoalFn: portalGoalCommands.keepMonthlyPortalGoal,
          },
          onAnswered: async () => {
            await markStale()
            focusTitle()
          },
        }}
        openSheet={sheet.open}
      />
      {sheet.sheet}
    </>
  )
}
