// Goal context — updateGoal server function

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
import { updateGoalSchema } from '../application/dto/goal.dto'

// ── updateGoal ────────────────────────────────────────────────────────

export const updateGoal = createServerFn({ method: 'POST' })
  .inputValidator(updateGoalSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = headersFromContext()
        const ctx = await resolveTenantContext(headers)
        if (!can(ctx.role, 'goal.update')) {
          throwContextError(
            'GoalError',
            makeGoalError(
              'forbidden',
              'Only AccountAdmin or PropertyManager can update goals',
            ),
            403,
          )
        }

        try {
          const { useCases } = getContainer()
          const result = await useCases.updateGoal({
            goalId: toGoalId(data.goalId),
            organizationId: ctx.organizationId,
            targetValue: data.targetValue,
            recurrenceRule: data.recurrenceRule ?? undefined,
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
              .with({ tag: 'recurrence_rule_not_allowed' }, () =>
                throwContextError(
                  'GoalError',
                  makeGoalError(
                    'validation_error',
                    'Recurrence rule can only be updated on recurring goals',
                  ),
                  400,
                ),
              )
              .with({ tag: 'invalid_target_value' }, () =>
                throwContextError(
                  'GoalError',
                  makeGoalError('validation_error', 'Target value must be positive'),
                  400,
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
      'goal.updateGoal',
    ),
  )
