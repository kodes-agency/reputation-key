// Goal context — query server functions (listGoals, getGoal)

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
  toPropertyId,
  toPortalId,
  toPortalGroupId,
  toGoalId,
  makeGoalError,
  goalErrorStatus,
} from './goal-shared'
import { listGoalsSchema, getGoalSchema } from '../application/dto/goal.dto'

// ── listGoals ─────────────────────────────────────────────────────────

export const listGoals = createServerFn({ method: 'GET' })
  .inputValidator(listGoalsSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        if (!can(ctx.role, 'goal.read')) {
          throwContextError(
            'GoalError',
            makeGoalError('forbidden', 'No goal read permission'),
            403,
          )
        }

        try {
          const { useCases } = getContainer()
          const result = await useCases.listGoals({
            organizationId: ctx.organizationId,
            propertyId: toPropertyId(data.propertyId),
            portalId: data.portalId ? toPortalId(data.portalId) : undefined,
            groupId: data.groupId ? toPortalGroupId(data.groupId) : undefined,
            status: data.status,
            goalType: data.goalType,
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
              .exhaustive()
          }

          return { goals: result._unsafeUnwrap() }
        } catch (e) {
          if (isGoalError(e)) throwContextError('GoalError', e, goalErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'GET',
      'goal.listGoals',
    ),
  )

// ── getGoal ───────────────────────────────────────────────────────────

export const getGoal = createServerFn({ method: 'GET' })
  .inputValidator(getGoalSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        if (!can(ctx.role, 'goal.read')) {
          throwContextError(
            'GoalError',
            makeGoalError('forbidden', 'No goal read permission'),
            403,
          )
        }

        try {
          const { useCases } = getContainer()
          const result = await useCases.getGoal({
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
              .exhaustive()
          }

          return result._unsafeUnwrap()
        } catch (e) {
          if (isGoalError(e)) throwContextError('GoalError', e, goalErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'GET',
      'goal.getGoal',
    ),
  )
