// Not now marks the setup step decided and suppresses reminders; it neither sets nor
// changes a goal.

import {
  actionFailureMessage,
  useActionMutation,
} from '#/components/hooks/use-action-mutation'
import { ratingGoalMutationKeys } from '#/contexts/reporting/rating-goals/ui/rating-goal-query-policy'
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
    invalidateKeys: [...ratingGoalMutationKeys(propertyId)],
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
