// Shared domain barrel — re-exports all shared domain utilities
// Contexts import from here, never from the individual files directly.
export type { Brand } from './brand'
export { brandId, isBrand } from './brand'

export type {
  OrganizationId,
  UserId,
  PropertyId,
  PortalId,
  ReviewId,
  FeedbackId,
  TeamId,
  MetricId,
  GoalId,
} from './ids'
export {
  organizationId,
  userId,
  propertyId,
  portalId,
  reviewId,
  feedbackId,
  teamId,
  metricId,
  goalId,
} from './ids'

export type { Result } from './result'
export {
  ok,
  err,
  okAsync,
  errAsync,
  ResultAsync,
  fromPromise,
  fromThrowable,
} from './result'

export { match, P, isMatching } from './pattern'

export type { TaggedError } from './errors'
export { createErrorFactory } from './errors'

export type { Clock } from './clock'
export { systemClock, fixedClock, advancingClock } from './clock'
