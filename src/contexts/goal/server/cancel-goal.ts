// Goal context — cancelGoal server function

import {
  createServerFn,
  tracedHandler,
  match,
  headersFromContext,
  resolveTenantContext,
  throwContextError,
  catchUntagged,
  can,
  getContainer,
  isGoalError,
  toGoalId,
  makeGoalError,
  goalErrorStatus,
} from './goal-shared'
import { cancelGoalSchema } from '../application/dto/goal.dto'

// ── cancelGoal ────────────────────────────────────────────────────────

export const cancelGoal = createServerFn({ method: 'POST' })
  .inputValidator(cancelGoalSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = headersFromContext()
        const ctx = await resolveTenantContext(headers)
        if (!can(ctx.role, 'goal.cancel')) {
          throwContextError(
            'GoalError',
            makeGoalError(
              'forbidden',
              'Only AccountAdmin or PropertyManager can cancel goals',
            ),
            403,
          )
        }

        try {
          const { useCases } = getContainer()
          const result = await useCases.cancelGoal({
            goalId: toGoalId(data.goalId),
            organizationId: ctx.organizationId,
            role: ctx.role,
          })

          if (result.isErr()) {
            match(result.error)
              .with({ tag: 'forbidden' }, () =>
                throwContextError(
                  'GoalError',
                  makeGoalError('forbidden', 'Forbidden'),
                  403,
                ),
              )
              .with({ tag: 'goal_not_found' }, () =>
                throwContextError(
                  'GoalError',
                  makeGoalError('not_found', 'Goal not found'),
                  404,
                ),
              )
              .with({ tag: 'goal_not_active' }, (e) =>
                throwContextError(
                  'GoalError',
                  makeGoalError('immutable_goal', `Goal is ${e.status}`),
                  409,
                ),
              )
              .exhaustive()
          }

          return { goal: result._unsafeUnwrap() }
        } catch (e) {
          if (isGoalError(e)) throwContextError('GoalError', e, goalErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'POST',
      'goal.cancelGoal',
    ),
  )
