import type { ConsumerEvent, ConsumerRegistry, OutboxRepository } from '#/shared/outbox'
import { validateEventPayload } from '#/shared/events/schema-registry'
import type {
  GoalSubject,
  MonthlyResultNotificationFactsLookup,
} from '#/contexts/reporting/application/public-api'
import { organizationId, propertyId, unbrand, type UserId } from '#/shared/domain/ids'
import type { ResponsibleManagerLookupPort } from '../application/ports/responsible-manager-lookup.port'
import type { UserLookupPort } from '../application/ports/notification-user-lookup.port'
import type { NotificationAudience } from '../application/notification-audience'
import {
  goalSubjectScope,
  resolveResponsibleRecipients,
} from '../application/responsible-recipients'
import type { NotificationJobEnqueuePort } from './inbox-notification-fanout'
import { INSERT_NOTIFICATION_JOB_NAME } from './jobs/insert-notification.job'
import {
  buildPropertyPayload,
  type PropertyPayloadDeps,
} from './notification-payload-facts'

export const ON_GOAL_MONTHLY_RESULT_CLOSED_CONSUMER =
  'notification.on-goal-monthly-result-closed' as const
export const ON_GOAL_MONTHLY_RESULT_REVISED_CONSUMER =
  'notification.on-goal-monthly-result-revised' as const

export type GoalNotificationConsumerDeps = PropertyPayloadDeps &
  Readonly<{
    queue: NotificationJobEnqueuePort
    monthlyResultFacts: MonthlyResultNotificationFactsLookup
    responsibleManagers: ResponsibleManagerLookupPort
    userLookup: Pick<UserLookupPort, 'findByRole'>
    receipts: Pick<OutboxRepository, 'insertReceipt'>
  }>

type Payload = Readonly<{
  organizationId?: string
  propertyId?: string
  programId: string
  assignmentId: string
  monthlyResultId: string
  evaluationState: string
  achieved: boolean | null
  status: 'closed'
}>

type Parsed = Readonly<{
  organizationId: string
  propertyId: string
  programId: string
  assignmentId: string
  monthlyResultId: string
  achieved: boolean | null
}>

type RevisedPayload = Readonly<{
  organizationId?: string
  propertyId?: string
  programId: string
  programVersionId: string
  assignmentId: string
  monthlyResultId: string
  evaluationState: 'eligible' | 'insufficient_data' | 'unavailable' | 'quarantined'
  achieved: boolean | null
  status: 'closed'
  revisionId: string
  revision: number
  outcomeChanged: boolean
  availabilityChanged: boolean
}>

type ParsedRevision = Readonly<{
  organizationId: string
  propertyId: string
  programId: string
  programVersionId: string
  assignmentId: string
  monthlyResultId: string
  evaluationState: RevisedPayload['evaluationState']
  achieved: boolean | null
  revisionId: string
  revision: number
  outcomeChanged: boolean
  availabilityChanged: boolean
}>

function parse(event: ConsumerEvent): Parsed {
  const payload = validateEventPayload(
    'goal.monthly_result.closed',
    event.eventVersion,
    event.payload,
  ) as Payload | undefined
  if (
    !payload ||
    (payload.organizationId !== undefined &&
      payload.organizationId !== event.organizationId) ||
    (payload.propertyId !== undefined && payload.propertyId !== event.propertyId)
  ) {
    throw new Error('Goal monthly-result envelope attribution mismatch')
  }
  if (event.propertyId === null) {
    throw new Error('Goal monthly-result envelope is missing property attribution')
  }
  return {
    organizationId: event.organizationId,
    propertyId: event.propertyId,
    programId: payload.programId,
    assignmentId: payload.assignmentId,
    monthlyResultId: payload.monthlyResultId,
    achieved: payload.achieved,
  }
}

function parseRevision(event: ConsumerEvent): ParsedRevision {
  const payload = validateEventPayload(
    'goal.monthly_result.revised',
    event.eventVersion,
    event.payload,
  ) as RevisedPayload | undefined
  if (
    !payload ||
    (payload.organizationId !== undefined &&
      payload.organizationId !== event.organizationId) ||
    (payload.propertyId !== undefined && payload.propertyId !== event.propertyId) ||
    event.sourceAggregateId !== payload.monthlyResultId
  ) {
    throw new Error('Goal monthly-result revision envelope attribution mismatch')
  }
  if (event.propertyId === null) {
    throw new Error(
      'Goal monthly-result revision envelope is missing property attribution',
    )
  }
  return {
    organizationId: event.organizationId,
    propertyId: event.propertyId,
    programId: payload.programId,
    programVersionId: payload.programVersionId,
    assignmentId: payload.assignmentId,
    monthlyResultId: payload.monthlyResultId,
    evaluationState: payload.evaluationState,
    achieved: payload.achieved,
    revisionId: payload.revisionId,
    revision: payload.revision,
    outcomeChanged: payload.outcomeChanged,
    availabilityChanged: payload.availabilityChanged,
  }
}

/**
 * A corrected month that is no longer eligible has no result to report, which
 * is not the same as missing its target; the copy keeps them apart.
 */
const goalOutcomeOf = (
  payload: Pick<ParsedRevision, 'evaluationState' | 'achieved'>,
): 'met' | 'not_met' | 'unavailable' => {
  if (payload.evaluationState !== 'eligible') return 'unavailable'
  return payload.achieved === true ? 'met' : 'not_met'
}

type GoalConsumerStatus = Readonly<{ status: 'applied' | 'obsolete' }>

/** Record this consumer's receipt for the delivery, and answer with it. */
async function settle(
  deps: GoalNotificationConsumerDeps,
  event: ConsumerEvent,
  consumerName:
    | typeof ON_GOAL_MONTHLY_RESULT_CLOSED_CONSUMER
    | typeof ON_GOAL_MONTHLY_RESULT_REVISED_CONSUMER,
  status: GoalConsumerStatus['status'],
): Promise<GoalConsumerStatus> {
  await deps.receipts.insertReceipt(event.eventId, consumerName, status)
  return { status }
}

/**
 * Queue a Goal notice for each current responsible recipient of the Goal's
 * subject. Monthly-result facts are system evaluations and carry no
 * synchronous human actor, so current responsibility is the audience
 * authority.
 */
async function enqueueGoalNotices(
  deps: GoalNotificationConsumerDeps,
  event: ConsumerEvent,
  result: Pick<Parsed, 'organizationId' | 'propertyId' | 'monthlyResultId'>,
  facts: Readonly<{ subject: GoalSubject; programName: string; periodMonth: string }>,
  notice: Readonly<{
    type: 'goal.completed' | 'goal.result_revised'
    /**
     * Which way the month stands NOW. A completion is always `met`; a
     * correction says whether the month still is, no longer is, or has no
     * usable result at all.
     */
    outcome: 'met' | 'not_met' | 'unavailable'
    audience: NotificationAudience
    jobId: (recipient: UserId) => string
  }>,
): Promise<void> {
  const organization = organizationId(result.organizationId)
  const property = propertyId(result.propertyId)
  const scope = goalSubjectScope(facts.subject)
  const recipients = await resolveResponsibleRecipients(deps, organization, scope)
  // A Goal subject sits inside one Property, the one this fact is filed under.
  const where = await buildPropertyPayload(deps, organization, property)

  await Promise.all(
    recipients.map((recipient) =>
      deps.queue.add(
        INSERT_NOTIFICATION_JOB_NAME,
        {
          userId: recipient,
          organizationId: organization,
          propertyId: property,
          type: notice.type,
          resourceType: 'goal' as const,
          resourceId: result.monthlyResultId,
          eventId: event.eventId,
          // Which month, whose goal, and which way it went. Ten sibling
          // results of one Program used to render ten identical rows.
          payload: {
            goalName: facts.programName,
            ...where,
            goalMonth: facts.periodMonth,
            goalSubjectKind: facts.subject.kind,
            goalOutcome: notice.outcome,
          },
          audience: notice.audience,
        },
        { jobId: notice.jobId(recipient) },
      ),
    ),
  )
}

export async function handleNotificationGoalMonthlyResultClosed(
  deps: GoalNotificationConsumerDeps,
  event: ConsumerEvent,
): Promise<GoalConsumerStatus> {
  const payload = parse(event)
  const consumer = ON_GOAL_MONTHLY_RESULT_CLOSED_CONSUMER

  if (payload.achieved !== true) return settle(deps, event, consumer, 'obsolete')

  const facts = await deps.monthlyResultFacts.findMonthlyResultNotificationFacts({
    organizationId: payload.organizationId,
    propertyId: payload.propertyId,
    assignmentId: payload.assignmentId,
    monthlyResultId: payload.monthlyResultId,
  })
  if (
    !facts ||
    facts.programId !== payload.programId ||
    facts.assignmentId !== payload.assignmentId ||
    facts.monthlyResultId !== payload.monthlyResultId ||
    (facts.subject.kind === 'property' && facts.subject.propertyId !== payload.propertyId)
  ) {
    return settle(deps, event, consumer, 'obsolete')
  }

  await enqueueGoalNotices(deps, event, payload, facts, {
    type: 'goal.completed',
    // The lookup returns nothing unless the month is achieved as it stands.
    outcome: 'met',
    // Delivery rechecks that the month is STILL achieved: a correction
    // may un-achieve it before this job runs.
    audience: {
      kind: 'goal_completion',
      programId: payload.programId,
      assignmentId: payload.assignmentId,
      monthlyResultId: payload.monthlyResultId,
    },
    jobId: (recipient) => `${event.eventId}-${unbrand(recipient)}`,
  })
  return settle(deps, event, consumer, 'applied')
}

export async function handleNotificationGoalMonthlyResultRevised(
  deps: GoalNotificationConsumerDeps,
  event: ConsumerEvent,
): Promise<GoalConsumerStatus> {
  const payload = parseRevision(event)
  const consumer = ON_GOAL_MONTHLY_RESULT_REVISED_CONSUMER
  if (!payload.outcomeChanged && !payload.availabilityChanged) {
    return settle(deps, event, consumer, 'obsolete')
  }

  const findRevision = deps.monthlyResultFacts.findMonthlyResultRevisionNotificationFacts
  if (!findRevision) {
    throw new Error('Goal monthly-result revision lookup is unavailable')
  }
  const facts = await findRevision({
    organizationId: payload.organizationId,
    propertyId: payload.propertyId,
    programId: payload.programId,
    programVersionId: payload.programVersionId,
    assignmentId: payload.assignmentId,
    monthlyResultId: payload.monthlyResultId,
    revisionId: payload.revisionId,
    revision: payload.revision,
  })
  // The facts describe the result's CURRENT head, which may be a later,
  // smaller correction without flags of its own. The notice stands while that
  // head still says what this correction said.
  if (
    !facts ||
    facts.programId !== payload.programId ||
    facts.programVersionId !== payload.programVersionId ||
    facts.assignmentId !== payload.assignmentId ||
    facts.monthlyResultId !== payload.monthlyResultId ||
    facts.revision < payload.revision ||
    facts.evaluationState !== payload.evaluationState ||
    facts.achieved !== payload.achieved ||
    (facts.subject.kind === 'property' && facts.subject.propertyId !== payload.propertyId)
  ) {
    return settle(deps, event, consumer, 'obsolete')
  }

  await enqueueGoalNotices(deps, event, payload, facts, {
    type: 'goal.result_revised',
    outcome: goalOutcomeOf(payload),
    audience: {
      kind: 'goal_result_revision',
      programId: payload.programId,
      programVersionId: payload.programVersionId,
      assignmentId: payload.assignmentId,
      monthlyResultId: payload.monthlyResultId,
      revisionId: payload.revisionId,
      revision: payload.revision,
      evaluationState: payload.evaluationState,
      achieved: payload.achieved,
    },
    // Keyed by the head this notice was judged against, not the event:
    // corrections handled late, after a later one committed, all describe
    // that head, so they converge on one notice per recipient.
    jobId: (recipient) =>
      `goal-result-revised-${payload.monthlyResultId}-r${facts.revision}-${unbrand(recipient)}`,
  })
  return settle(deps, event, consumer, 'applied')
}

export function registerGoalNotificationConsumer(
  registry: ConsumerRegistry,
  deps: GoalNotificationConsumerDeps,
): void {
  const { registerConsumer } = registry
  registerConsumer({
    eventType: 'goal.monthly_result.closed',
    consumerName: 'notification.on-goal-monthly-result-closed',
    module: 'notification.goal-outbox-consumers',
    handler: (event) => handleNotificationGoalMonthlyResultClosed(deps, event),
  })
  registerConsumer({
    eventType: 'goal.monthly_result.revised',
    consumerName: 'notification.on-goal-monthly-result-revised',
    module: 'notification.goal-outbox-consumers',
    handler: (event) => handleNotificationGoalMonthlyResultRevised(deps, event),
  })
}
