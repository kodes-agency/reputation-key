// "Not now" for a Property's Google rating goal: the setup checklist counts its
// step as decided and stops reminding (owner, 2026-10-14). The setup strip on the
// Overview and in Property settings offers it beside the step, and the Google
// import's last step offers it instead of the goal. It sets and changes no goal.
import {
  actionFailureMessage,
  useActionMutation,
} from '#/components/hooks/use-action-mutation'
import { dashboardKeys, goalKeys, propertyKeys } from '#/shared/queries/query-keys'
import { ratingGoalCommands } from './-rating-goal-queries'

/**
 * The "Not now" command for one Property. A failure is a toast (an immediate
 * action), so no caller shows a banner of its own.
 */
export function useRatingGoalNotNowAction(propertyId: string) {
  return useActionMutation(ratingGoalCommands.deferRatingGoal, {
    // The checklist, the Properties list, and the goal's own reads.
    invalidateKeys: [
      propertyKeys.setup(propertyId),
      propertyKeys.setupSummaries(),
      dashboardKeys.fleets(),
      goalKeys.ratingGoal(propertyId),
    ],
    errorMessage: actionFailureMessage(
      "Couldn't save “Not now” for the Google rating goal.",
    ),
  })
}

/** "Not now" as the setup strip takes it: `choose` sends it once. */
export function useRatingGoalNotNow(
  propertyId: string,
): Readonly<{ choose: () => void; pending: boolean }> {
  const notNow = useRatingGoalNotNowAction(propertyId)
  return {
    choose: () => void notNow({ data: { propertyId } }).catch(() => undefined),
    pending: notNow.isPending,
  }
}
