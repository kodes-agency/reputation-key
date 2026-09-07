import type { ConsumerEvent, ConsumerRegistry, OutboxRepository } from '#/shared/outbox'
import { validateEventPayload } from '#/shared/events/schema-registry'
import type {
  GoalSubject,
  MonthlyResultNotificationFactsLookup,
} from '#/contexts/goal/application/public-api'
import { organizationId, propertyId, unbrand } from '#/shared/domain/ids'
import type { ResponsibleManagerLookupPort } from '../application/ports/responsible-manager-lookup.port'
import type { UserLookupPort } from '../application/ports/user-lookup.port'
import {
  resolveResponsibleRecipients,
  type ResponsibleScope,
} from '../application/responsible-recipients'
import type { NotificationJobEnqueuePort } from './inbox-notification-fanout'
import { INSERT_NOTIFICATION_JOB_NAME } from './jobs/insert-notification.job'

export const ON_GOAL_MONTHLY_RESULT_CLOSED_CONSUMER =
  'notification.on-goal-monthly-result-closed' as const
export const ON_GOAL_MONTHLY_RESULT_REVISED_CONSUMER =
  'notification.on-goal-monthly-result-revised' as const

export type GoalNotificationConsumerDeps = Readonly<{
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

const scopeFromFacts = (subject: GoalSubject): ResponsibleScope =>
  subject.kind === 'property'
    ? { kind: 'property', propertyId: subject.propertyId }
    : subject.kind === 'portal_group'
      ? { kind: 'portal_group', portalGroupId: subject.portalGroupId }
      : { kind: 'portal', portalId: subject.portalId }

export async function handleNotificationGoalMonthlyResultClosed(
  deps: GoalNotificationConsumerDeps,
  event: ConsumerEvent,
): Promise<Readonly<{ status: 'applied' | 'obsolete' }>> {
  const payload = parse(event)

  if (payload.achieved !== true) {
    await deps.receipts.insertReceipt(
      event.eventId,
      ON_GOAL_MONTHLY_RESULT_CLOSED_CONSUMER,
      'obsolete',
    )
    return { status: 'obsolete' }
  }

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
    await deps.receipts.insertReceipt(
      event.eventId,
      ON_GOAL_MONTHLY_RESULT_CLOSED_CONSUMER,
      'obsolete',
    )
    return { status: 'obsolete' }
  }

  const organization = organizationId(payload.organizationId)
  const property = propertyId(payload.propertyId)
  const scope = scopeFromFacts(facts.subject)
  // Monthly-result closure is a system evaluation and carries no synchronous
  // human actor; current responsible recipients are the audience authority.
  const recipients = await resolveResponsibleRecipients(deps, organization, scope)

  await Promise.all(
    recipients.map((recipient) =>
      deps.queue.add(
        INSERT_NOTIFICATION_JOB_NAME,
        {
          userId: recipient,
          organizationId: organization,
          propertyId: property,
          type: 'goal.completed' as const,
          resourceType: 'goal' as const,
          resourceId: payload.monthlyResultId,
          eventId: event.eventId,
          payload: { goalName: facts.programName },
          audience: { kind: 'responsible_scope' as const, scope },
        },
        { jobId: `${event.eventId}-${unbrand(recipient)}` },
      ),
    ),
  )

  await deps.receipts.insertReceipt(
    event.eventId,
    ON_GOAL_MONTHLY_RESULT_CLOSED_CONSUMER,
    'applied',
  )
  return { status: 'applied' }
}

export async function handleNotificationGoalMonthlyResultRevised(
  deps: GoalNotificationConsumerDeps,
  event: ConsumerEvent,
): Promise<Readonly<{ status: 'applied' | 'obsolete' }>> {
  const payload = parseRevision(event)
  if (!payload.outcomeChanged && !payload.availabilityChanged) {
    await deps.receipts.insertReceipt(
      event.eventId,
      ON_GOAL_MONTHLY_RESULT_REVISED_CONSUMER,
      'obsolete',
    )
    return { status: 'obsolete' }
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
  if (
    !facts ||
    facts.programId !== payload.programId ||
    facts.programVersionId !== payload.programVersionId ||
    facts.assignmentId !== payload.assignmentId ||
    facts.monthlyResultId !== payload.monthlyResultId ||
    facts.revisionId !== payload.revisionId ||
    facts.revision !== payload.revision ||
    facts.evaluationState !== payload.evaluationState ||
    facts.achieved !== payload.achieved ||
    (facts.subject.kind === 'property' && facts.subject.propertyId !== payload.propertyId)
  ) {
    await deps.receipts.insertReceipt(
      event.eventId,
      ON_GOAL_MONTHLY_RESULT_REVISED_CONSUMER,
      'obsolete',
    )
    return { status: 'obsolete' }
  }

  const organization = organizationId(payload.organizationId)
  const property = propertyId(payload.propertyId)
  const scope = scopeFromFacts(facts.subject)
  const recipients = await resolveResponsibleRecipients(deps, organization, scope)

  await Promise.all(
    recipients.map((recipient) =>
      deps.queue.add(
        INSERT_NOTIFICATION_JOB_NAME,
        {
          userId: recipient,
          organizationId: organization,
          propertyId: property,
          type: 'goal.result_revised' as const,
          resourceType: 'goal' as const,
          resourceId: payload.monthlyResultId,
          eventId: event.eventId,
          payload: { goalName: facts.programName },
          audience: {
            kind: 'goal_result_revision' as const,
            programId: payload.programId,
            programVersionId: payload.programVersionId,
            assignmentId: payload.assignmentId,
            monthlyResultId: payload.monthlyResultId,
            revisionId: payload.revisionId,
            revision: payload.revision,
            evaluationState: payload.evaluationState,
            achieved: payload.achieved,
          },
        },
        { jobId: `${event.eventId}-${unbrand(recipient)}` },
      ),
    ),
  )

  await deps.receipts.insertReceipt(
    event.eventId,
    ON_GOAL_MONTHLY_RESULT_REVISED_CONSUMER,
    'applied',
  )
  return { status: 'applied' }
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
