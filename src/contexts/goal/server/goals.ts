// Goal context — server functions
// Per architecture: thin — resolve auth → validate input → call use case → return

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { match } from 'ts-pattern'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { throwContextError } from '#/shared/auth/server-errors'
import { can } from '#/shared/domain/permissions'
import { getContainer } from '#/composition'
import {
  createGoalSchema,
  updateGoalSchema,
  cancelGoalSchema,
  listGoalsSchema,
  getGoalSchema,
} from '../application/dto/goal.dto'
import { isGoalError } from '../domain/errors'
import type { GoalErrorCode } from '../domain/errors'
import {
  propertyId as toPropertyId,
  portalId as toPortalId,
  teamId as toTeamId,
  staffId as toStaffId,
  goalId as toGoalId,
} from '#/shared/domain/ids'
import type { MetricKey, AggregationFunction } from '#/shared/domain/metric-keys'

// ── Helpers ───────────────────────────────────────────────────────────

/** Local error constructor — server must not import domain error constructors. */
const makeGoalError = (code: GoalErrorCode, message: string) => ({
  _tag: 'GoalError' as const,
  code,
  message,
})

export const goalErrorStatus = (code: GoalErrorCode): number =>
  match(code)
    .with('forbidden', () => 403)
    .with('not_found', () => 404)
    .with('validation_error', () => 400)
    .with('immutable_goal', () => 409)
    .exhaustive()

// ── createGoal ────────────────────────────────────────────────────────

export const createGoal = createServerFn({ method: 'POST' })
  .inputValidator(createGoalSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = headersFromContext()
        const ctx = await resolveTenantContext(headers)
        if (!can(ctx.role, 'goal.write')) {
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
            teamId: data.teamId ? toTeamId(data.teamId) : null,
            staffId: data.staffId ? toStaffId(data.staffId) : null,
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
          })

          if (result.isErr()) {
            const error = result.error
            switch (error.tag) {
              case 'construction_error':
                throwContextError(
                  'GoalError',
                  makeGoalError('validation_error', error.error.tag),
                  400,
                )
                break
              case 'instance_construction_error':
                throwContextError(
                  'GoalError',
                  makeGoalError('validation_error', error.error.tag),
                  400,
                )
                break
            }
          }

          return result.value
        } catch (e) {
          if (isGoalError(e)) throwContextError('GoalError', e, goalErrorStatus(e.code))
          throw e
        }
      },
      'POST',
      'goal.createGoal',
    ),
  )

// ── updateGoal ────────────────────────────────────────────────────────

export const updateGoal = createServerFn({ method: 'POST' })
  .inputValidator(updateGoalSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = headersFromContext()
        const ctx = await resolveTenantContext(headers)
        if (!can(ctx.role, 'goal.write')) {
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
          })

          if (result.isErr()) {
            const error = result.error
            switch (error.tag) {
              case 'goal_not_found':
                throwContextError(
                  'GoalError',
                  makeGoalError('not_found', 'Goal not found'),
                  404,
                )
                break
              case 'goal_not_active':
                throwContextError(
                  'GoalError',
                  makeGoalError('immutable_goal', `Goal is ${error.status}`),
                  409,
                )
                break
              case 'recurrence_rule_not_allowed':
                throwContextError(
                  'GoalError',
                  makeGoalError(
                    'validation_error',
                    'Recurrence rule can only be updated on recurring goals',
                  ),
                  400,
                )
                break
            }
          }

          return { goal: result.value }
        } catch (e) {
          if (isGoalError(e)) throwContextError('GoalError', e, goalErrorStatus(e.code))
          throw e
        }
      },
      'POST',
      'goal.updateGoal',
    ),
  )

// ── cancelGoal ────────────────────────────────────────────────────────

export const cancelGoal = createServerFn({ method: 'POST' })
  .inputValidator(cancelGoalSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = headersFromContext()
        const ctx = await resolveTenantContext(headers)
        if (!can(ctx.role, 'goal.write')) {
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
          })

          if (result.isErr()) {
            const error = result.error
            switch (error.tag) {
              case 'goal_not_found':
                throwContextError(
                  'GoalError',
                  makeGoalError('not_found', 'Goal not found'),
                  404,
                )
                break
              case 'goal_not_active':
                throwContextError(
                  'GoalError',
                  makeGoalError('immutable_goal', `Goal is ${error.status}`),
                  409,
                )
                break
            }
          }

          return { goal: result.value }
        } catch (e) {
          if (isGoalError(e)) throwContextError('GoalError', e, goalErrorStatus(e.code))
          throw e
        }
      },
      'POST',
      'goal.cancelGoal',
    ),
  )

// ── listGoals ─────────────────────────────────────────────────────────

export const listGoals = createServerFn({ method: 'GET' })
  .inputValidator(listGoalsSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = headersFromContext()
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
          const goals = await useCases.listGoals({
            organizationId: ctx.organizationId,
            propertyId: toPropertyId(data.propertyId),
            portalId: data.portalId ? toPortalId(data.portalId) : undefined,
            teamId: data.teamId ? toTeamId(data.teamId) : undefined,
            staffId: data.staffId ? toStaffId(data.staffId) : undefined,
            status: data.status,
            goalType: data.goalType,
          })
          return { goals }
        } catch (e) {
          if (isGoalError(e)) throwContextError('GoalError', e, goalErrorStatus(e.code))
          throw e
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
        const headers = headersFromContext()
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
          })

          if (result.isErr()) {
            throwContextError(
              'GoalError',
              makeGoalError('not_found', 'Goal not found'),
              404,
            )
          }

          return result.value
        } catch (e) {
          if (isGoalError(e)) throwContextError('GoalError', e, goalErrorStatus(e.code))
          throw e
        }
      },
      'GET',
      'goal.getGoal',
    ),
  )
