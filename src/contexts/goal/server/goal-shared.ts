// Goal context — shared server utilities

import { match } from 'ts-pattern'
import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { HTTP_STATUS } from '#/shared/http/status'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { can } from '#/shared/domain/permissions'
import { getContainer } from '#/composition'
import { isGoalError } from '../domain/errors'
import type { GoalErrorCode } from '../domain/errors'
import {
  propertyId as toPropertyId,
  portalId as toPortalId,
  portalGroupId as toPortalGroupId,
  goalId as toGoalId,
} from '#/shared/domain/ids'
import type { MetricKey, AggregationFunction } from '#/shared/domain/metric-keys'

/** Local error constructor — server must not import domain error constructors. */
export const makeGoalError = (code: GoalErrorCode, message: string) => ({
  _tag: 'GoalError' as const,
  code,
  message,
})

export const goalErrorStatus = (code: GoalErrorCode): number =>
  match(code)
    .with('forbidden', () => HTTP_STATUS.FORBIDDEN)
    .with('not_found', () => HTTP_STATUS.NOT_FOUND)
    .with('validation_error', () => HTTP_STATUS.BAD_REQUEST)
    .with('immutable_goal', () => HTTP_STATUS.CONFLICT)
    .exhaustive()

export {
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
}
export type { MetricKey, AggregationFunction }
