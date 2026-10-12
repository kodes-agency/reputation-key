// Feed activity surface — how a Goal monthly-result fact becomes a Recent
// Activity row.
//
// Three facts describe one monthly result: it started reconciling, it closed,
// and a later correction revised it. Each projects a content-free transition
// on the result. The consumer (activity-outbox-consumers.ts) validates the
// fact's attribution and builds the entry; this module says what the row says.

import type { ConsumerEvent } from '#/shared/outbox'
import type { MonthlyResultNotificationFactsLookup } from '#/contexts/reporting/application/public-api'
import type { ProjectRecentActivityInput } from '../application/use-cases/project-recent-activity'
import {
  optionalString,
  stringValue,
  type ActivityFactPayload,
} from './activity-fact-fields'
import { goalMonthMarker } from './goal-month-marker'

/**
 * Reporting's delivery-time read of a closed Goal month: the source of the one
 * marker a met month's row may carry. The same read the Goal notices use.
 */
export type GoalResultFactsLookup = Pick<
  MonthlyResultNotificationFactsLookup,
  'findMonthlyResultNotificationFacts'
>

export type GoalActivityEventType =
  | 'goal.monthly_result.closed'
  | 'goal.monthly_result.reconciled'
  | 'goal.monthly_result.revised'

type GoalActivityFields = Pick<
  ProjectRecentActivityInput,
  'action' | 'resourceType' | 'resourceId' | 'userId' | 'source' | 'payload'
>

/** A Goal fact that does not name its own scope takes it from the envelope. */
export const goalPayloadWithEnvelopeScope = (
  event: ConsumerEvent,
  payload: ActivityFactPayload,
): ActivityFactPayload => {
  if (!event.propertyId) {
    throw new Error('Recent Activity Goal fact has no Property attribution')
  }
  return {
    ...payload,
    organizationId: optionalString(payload, 'organizationId') ?? event.organizationId,
    propertyId: optionalString(payload, 'propertyId') ?? event.propertyId,
  }
}

const goalOutcome = (payload: ActivityFactPayload): string => {
  const achieved = payload.achieved
  if (achieved === true) return 'achieved'
  if (achieved === false) return 'not_achieved'
  return stringValue(payload, 'evaluationState')
}

const goalRevisionDetail = (payload: ActivityFactPayload): string => {
  const outcomeChanged = payload.outcomeChanged === true
  const availabilityChanged = payload.availabilityChanged === true
  if (outcomeChanged && availabilityChanged) {
    return 'outcome_and_availability_changed'
  }
  if (outcomeChanged) return 'outcome_changed'
  if (availabilityChanged) return 'availability_changed'
  return 'revision_recorded'
}

/**
 * A month that closed as met also says, in the same closed token the Goal
 * notices use, when its target did not stand for the whole month: the goal was
 * set after the month began, or its target was changed while it ran. "Met"
 * against a goal set on the 20th, or against a target lowered on the 20th, is
 * true and still needs saying. Only a met month is asked about; Reporting
 * answers for the result as it stands now.
 */
const goalClosedDetail = async (
  lookup: GoalResultFactsLookup,
  goalPayload: ActivityFactPayload,
): Promise<string> => {
  const evaluationState = stringValue(goalPayload, 'evaluationState')
  if (goalPayload.achieved !== true) return evaluationState
  const facts = await lookup.findMonthlyResultNotificationFacts({
    organizationId: stringValue(goalPayload, 'organizationId'),
    propertyId: stringValue(goalPayload, 'propertyId'),
    assignmentId: stringValue(goalPayload, 'assignmentId'),
    monthlyResultId: stringValue(goalPayload, 'monthlyResultId'),
  })
  const marker = facts ? goalMonthMarker(facts) : null
  return marker === null ? evaluationState : `${evaluationState}:${marker}`
}

const goalResultTransition = async (
  lookup: GoalResultFactsLookup,
  eventType: GoalActivityEventType,
  goalPayload: ActivityFactPayload,
): Promise<Readonly<{ to: string; detail: string }>> => {
  switch (eventType) {
    case 'goal.monthly_result.reconciled':
      return { to: 'reconciling', detail: stringValue(goalPayload, 'evaluationState') }
    case 'goal.monthly_result.revised':
      return { to: goalOutcome(goalPayload), detail: goalRevisionDetail(goalPayload) }
    case 'goal.monthly_result.closed':
      return {
        to: goalOutcome(goalPayload),
        detail: await goalClosedDetail(lookup, goalPayload),
      }
  }
}

/**
 * What the row says for one Goal fact. The caller has already checked the
 * payload's attribution: the closed month's read happens here, after it.
 */
export const goalResultActivity = async (
  lookup: GoalResultFactsLookup,
  eventType: GoalActivityEventType,
  goalPayload: ActivityFactPayload,
): Promise<GoalActivityFields> => ({
  action: 'changed',
  resourceType: 'goal',
  resourceId: stringValue(goalPayload, 'monthlyResultId'),
  userId: null,
  source: 'web',
  payload: {
    subject: 'goal_result',
    from: null,
    ...(await goalResultTransition(lookup, eventType, goalPayload)),
  },
})
