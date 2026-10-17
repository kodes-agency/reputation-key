// Property Google rating goal — server functions.
//
// Each handler runs through `withRatingGoals`, which asks the execution policy
// (goal.read / create / update / cancel, capability goal.use, the Property's
// grant) before the use case reads or writes anything. The detail then links
// its low reviews to the Inbox (`withInboxItems`, which asks for inbox.read),
// so no review id reaches the browser.
import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
// For `.validator(...)` only: never re-export these (an `export … from` would
// keep the DTO module and its zod calls in first paint, #794). The read
// results are typed in application/dto/rating-goal.types.ts.
import {
  changeRatingGoalSchema,
  endRatingGoalSchema,
  ratingGoalPropertySchema,
  setRatingGoalSchema,
} from '../application/dto/rating-goal.dto'
import { withInboxItems } from './rating-goal-inbox-links.server'
import { withRatingGoals } from './rating-goal-request.server'

export const getRatingGoalSetup = createServerFn({ method: 'GET' })
  .validator(ratingGoalPropertySchema)
  .handler(
    tracedHandler(
      async ({ data }) =>
        withRatingGoals((ratingGoals, policy, actor) =>
          ratingGoals.setup(policy, data, actor),
        ),
      'GET',
      'goal.getRatingGoalSetup',
    ),
  )

export const getRatingGoalCard = createServerFn({ method: 'GET' })
  .validator(ratingGoalPropertySchema)
  .handler(
    tracedHandler(
      async ({ data }) =>
        withRatingGoals((ratingGoals, policy, actor) =>
          ratingGoals.card(policy, data, actor),
        ),
      'GET',
      'goal.getRatingGoalCard',
    ),
  )

export const getRatingGoalDetail = createServerFn({ method: 'GET' })
  .validator(ratingGoalPropertySchema)
  .handler(
    tracedHandler(
      async ({ data }) =>
        withRatingGoals(async (ratingGoals, policy, actor, ctx) => {
          const detail = await ratingGoals.detail(policy, data, actor)
          return detail === null ? null : withInboxItems(detail, data.propertyId, ctx)
        }),
      'GET',
      'goal.getRatingGoalDetail',
    ),
  )

export const getRatingGoalHistory = createServerFn({ method: 'GET' })
  .validator(ratingGoalPropertySchema)
  .handler(
    tracedHandler(
      async ({ data }) =>
        withRatingGoals((ratingGoals, policy, actor) =>
          ratingGoals.history(policy, data, actor),
        ),
      'GET',
      'goal.getRatingGoalHistory',
    ),
  )

export const setRatingGoal = createServerFn({ method: 'POST' })
  .validator(setRatingGoalSchema)
  .handler(
    tracedHandler(
      async ({ data }) =>
        withRatingGoals((ratingGoals, policy, actor) =>
          ratingGoals.set(policy, data, actor),
        ),
      'POST',
      'goal.setRatingGoal',
    ),
  )

export const changeRatingGoal = createServerFn({ method: 'POST' })
  .validator(changeRatingGoalSchema)
  .handler(
    tracedHandler(
      async ({ data }) =>
        withRatingGoals((ratingGoals, policy, actor) =>
          ratingGoals.change(policy, data, actor),
        ),
      'POST',
      'goal.changeRatingGoal',
    ),
  )

export const endRatingGoal = createServerFn({ method: 'POST' })
  .validator(endRatingGoalSchema)
  .handler(
    tracedHandler(
      async ({ data }) =>
        withRatingGoals((ratingGoals, policy, actor) =>
          ratingGoals.end(policy, data, actor),
        ),
      'POST',
      'goal.endRatingGoal',
    ),
  )

/** "Not now" for the Property's rating goal: its setup step counts as decided. */
export const deferRatingGoal = createServerFn({ method: 'POST' })
  .validator(ratingGoalPropertySchema)
  .handler(
    tracedHandler(
      async ({ data }) =>
        withRatingGoals((ratingGoals, policy, actor) =>
          ratingGoals.defer(policy, data, actor),
        ),
      'POST',
      'goal.deferRatingGoal',
    ),
  )
