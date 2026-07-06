// Goal context — server functions
// Per architecture: thin — resolve auth → validate input → call use case → return

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { match } from 'ts-pattern'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
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
  portalGroupId as toPortalGroupId,
  goalId as toGoalId,
} from '#/shared/domain/ids'

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
    .with(
      'ambiguous_scope',
      'invalid_metric_for_scope',
      'invalid_aggregation_for_metric',
      'period_not_allowed',
      'period_required',
      'invalid_period',
      'rolling_window_required',
      'rolling_window_not_allowed',
      'recurrence_rule_required',
      'recurrence_rule_not_allowed',
      'empty_name',
      () => 400,
    )
    .with(
      'name_too_long',
      'description_too_long',
      'invalid_target_value',
      'repo_insert_failed',
      'progress_not_found',
      'unsupported_aggregation',
      'not_found_or_tenant_mismatch',
      'upsert_failed',
      () => 400,
    )
    .exhaustive()

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
            makeGoalError('forbidden', 'No goal create permission'),
            403,
          )
        }
        try {
          const { useCases } = getContainer()
          const result = await useCases.createGoal({
            organizationId: ctx.organizationId,
            propertyId: toPropertyId(data.propertyId),
            portalId: data.portalId ? toPortalId(data.portalId) : null,
            portalGroupId: data.portalGroupId
              ? toPortalGroupId(data.portalGroupId)
              : null,
            name: data.name,
            description: data.description ?? null,
            createdBy: ctx.userId,
            goalType: data.goalType,
            aggregationFunction: data.aggregationFunction,
            metricKey: data.metricKey,
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
                  makeGoalError('validation_error', e.error.code),
                  400,
                ),
              )
              .with({ tag: 'instance_construction_error' }, (e) =>
                throwContextError(
                  'GoalError',
                  makeGoalError('validation_error', e.error.code),
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

          return result.match(
            (value) => value,
            (error) => {
              throw new Error(
                `goal.createGoal: unmapped error variant after exhaustive mapping: ${JSON.stringify(error)}`,
              )
            },
          )
        } catch (e) {
          if (isGoalError(e)) throwContextError('GoalError', e, goalErrorStatus(e.code))
          throw catchUntagged(e)
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
        const headers = await headersFromContext()
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
            userId: ctx.userId,
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

          const updated = result.match(
            (value) => value,
            (error) => {
              throw new Error(
                `goal.updateGoal: unmapped error variant after exhaustive mapping: ${JSON.stringify(error)}`,
              )
            },
          )
          return { goal: updated }
        } catch (e) {
          if (isGoalError(e)) throwContextError('GoalError', e, goalErrorStatus(e.code))
          throw catchUntagged(e)
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
        const headers = await headersFromContext()
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
            userId: ctx.userId,
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

          const cancelled = result.match(
            (value) => value,
            (error) => {
              throw new Error(
                `goal.cancelGoal: unmapped error variant after exhaustive mapping: ${JSON.stringify(error)}`,
              )
            },
          )
          return { goal: cancelled }
        } catch (e) {
          if (isGoalError(e)) throwContextError('GoalError', e, goalErrorStatus(e.code))
          throw catchUntagged(e)
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
            userId: ctx.userId,
            propertyId: toPropertyId(data.propertyId),
            portalId: data.portalId ? toPortalId(data.portalId) : undefined,
            portalGroupId: data.portalGroupId
              ? toPortalGroupId(data.portalGroupId)
              : undefined,
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

          const goals = result.match(
            (value) => value,
            (error) => {
              throw new Error(
                `goal.listGoals: unmapped error variant after exhaustive mapping: ${JSON.stringify(error)}`,
              )
            },
          )
          return { goals }
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
            userId: ctx.userId,
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

          return result.match(
            (value) => value,
            (error) => {
              throw new Error(
                `goal.getGoal: unmapped error variant after exhaustive mapping: ${JSON.stringify(error)}`,
              )
            },
          )
        } catch (e) {
          if (isGoalError(e)) throwContextError('GoalError', e, goalErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'GET',
      'goal.getGoal',
    ),
  )
