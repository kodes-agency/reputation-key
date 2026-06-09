// Goal context — createGoal server function

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
  makeGoalError,
  goalErrorStatus,
} from './goal-shared'
import type { MetricKey, AggregationFunction } from './goal-shared'
import { createGoalSchema } from '../application/dto/goal.dto'

// ── createGoal ────────────────────────────────────────────────────────

export const createGoal = createServerFn({ method: 'POST' })
  .inputValidator(createGoalSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        if (!can(ctx.role, 'goal.create')) {
          throwContextError(
            'GoalError',
            makeGoalError(
              'forbidden',
              'Only AccountAdmin or PropertyManager can create goals',
            ),
            403,
          )
        }

        try {
          const { useCases } = getContainer()
          const result = await useCases.createGoal({
            organizationId: ctx.organizationId,
            propertyId: toPropertyId(data.propertyId),
            portalId: data.portalId ? toPortalId(data.portalId) : null,
            groupId: data.groupId ? toPortalGroupId(data.groupId) : null,
            name: data.name,
            description: data.description ?? null,
            createdBy: ctx.userId,
            goalType: data.goalType,
            aggregationFunction: data.aggregationFunction as AggregationFunction,
            metricKey: data.metricKey as MetricKey,
            targetValue: data.targetValue,
            periodStart: data.periodStart ? new Date(data.periodStart) : null,
            periodEnd: data.periodEnd ? new Date(data.periodEnd) : null,
            recurrenceRule: data.recurrenceRule ?? null,
            rollingWindowDays: data.rollingWindowDays ?? null,
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
              .with({ tag: 'construction_error' }, (e) =>
                throwContextError(
                  'GoalError',
                  makeGoalError('validation_error', e.error.tag),
                  400,
                ),
              )
              .with({ tag: 'instance_construction_error' }, (e) =>
                throwContextError(
                  'GoalError',
                  makeGoalError('validation_error', e.error.tag),
                  400,
                ),
              )
              .with({ tag: 'progress_query_error' }, (e) =>
                throwContextError(
                  'GoalError',
                  makeGoalError(
                    'validation_error',
                    `Unexpected progress query error: ${e.errorTag}`,
                  ),
                  500,
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
      'POST',
      'goal.createGoal',
    ),
  )
