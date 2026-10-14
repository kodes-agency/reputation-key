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
 * What the strip's "Not now" says once it is saved: the step is gone, so where
 * the goal is now. The import's last step says the same in its own sentence.
 */
const NOT_NOW_SAVED =
  'No Google rating goal for now. You can set one on Goals at any time.'

/**
 * The "Not now" command for one Property. A failure is a toast (an immediate
 * action), so no caller shows a banner of its own. `successMessage` is for a
 * caller whose screen does not say it itself (the strip's step just goes).
 */
export function useRatingGoalNotNowAction(
  propertyId: string,
  options: Readonly<{ successMessage?: string }> = {},
) {
  return useActionMutation(ratingGoalCommands.deferRatingGoal, {
    successMessage: options.successMessage,
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

/** "Not now" as the setup strip takes it: `choose` sends it once, and a toast says where the goal went. */
export function useRatingGoalNotNow(
  propertyId: string,
): Readonly<{ choose: () => void; pending: boolean }> {
  const notNow = useRatingGoalNotNowAction(propertyId, { successMessage: NOT_NOW_SAVED })
  return {
    choose: () => void notNow({ data: { propertyId } }).catch(() => undefined),
    pending: notNow.isPending,
  }
}
