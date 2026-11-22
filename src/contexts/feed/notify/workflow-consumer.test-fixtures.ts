// A small harness for the focused workflow-consumer suites: the fakes, one
// envelope builder, and the queued jobs read back. The long route suite keeps
// its own copy; this one exists so a new audience rule gets a short file of
// its own instead of growing that one.

import type { ConsumerEvent } from '#/shared/outbox/consumer-registry'
import { toOutboxEvent } from '#/shared/outbox/event-adapter'
import { buildConsumerEvent } from '#/shared/outbox/envelope'
import { parseNotificationPayload } from '../domain/notification-payload'
import { renderNotification } from '../domain/notification-templates'
import { unbrand } from '#/shared/domain/ids'
import type {
  WORKFLOW_NOTIFICATION_CONSUMERS,
  WorkflowNotificationConsumerDeps,
} from './inbox-workflow.server'
import {
  createNotificationConsumerDeps,
  NOTIF_TEST_IDS,
  type FakeNotificationConsumerDeps,
} from '../infrastructure/notification-consumer-test-fixtures'
import type { QueuedNotice } from '../infrastructure/notification-consumer-test-fixtures'

export type WorkflowTestDeps = WorkflowNotificationConsumerDeps & {
  receipts: FakeNotificationConsumerDeps['receipts']
  fakes: FakeNotificationConsumerDeps
}

export const WORKFLOW_EVENT_ID = '30000000-0000-4000-8000-000000000009'

/** One AccountAdmin and one responsible manager, both eligible, as a start. */
export const makeWorkflowDeps = (): WorkflowTestDeps => {
  const fakes = createNotificationConsumerDeps()
  fakes.userLookup.findByRole.mockResolvedValue([NOTIF_TEST_IDS.admin1])
  fakes.responsibleManagers.findForProperty.mockResolvedValue([NOTIF_TEST_IDS.manager1])
  fakes.responsibleManagers.isEligibleForProperty.mockResolvedValue(true)
  return {
    noticeWriter: fakes.noticeWriter,
    userLookup: fakes.userLookup,
    responsibleManagers: fakes.responsibleManagers,
    inboxItemLookup: fakes.inboxItemLookup,
    replyApproval: fakes.replyApproval,
    activeProperty: fakes.activeProperty,
    retireMovedAssignment: fakes.retireMovedAssignment,
    clock: fakes.clock,
    logger: fakes.logger,
    receipts: fakes.receipts,
    fakes,
  }
}

export const workflowEvent = (
  eventType: (typeof WORKFLOW_NOTIFICATION_CONSUMERS)[number]['eventType'],
  payload: Readonly<Record<string, unknown>>,
  overrides: Partial<ConsumerEvent> = {},
): ConsumerEvent => ({
  eventId: WORKFLOW_EVENT_ID,
  eventType,
  eventVersion: 1,
  payload: {
    organizationId: unbrand(NOTIF_TEST_IDS.orgId),
    propertyId: unbrand(NOTIF_TEST_IDS.propId),
    occurredAt: NOTIF_TEST_IDS.now.toISOString(),
    ...payload,
  },
  organizationId: unbrand(NOTIF_TEST_IDS.orgId),
  propertyId: unbrand(NOTIF_TEST_IDS.propId),
  sourceContext: eventType.split('.')[0]!,
  sourceAggregateId: 'aggregate-1',
  occurredAt: NOTIF_TEST_IDS.now.toISOString(),
  recordedAt: NOTIF_TEST_IDS.now.toISOString(),
  correlationId: 'correlation-1',
  ...overrides,
})

export const queuedJobs = (deps: WorkflowTestDeps): readonly QueuedNotice[] =>
  deps.fakes.jobs.map((job) => job.data as QueuedNotice)

const WEB_SOURCE = 'web'

export const assignedPayload = (input: {
  assignedTo: string
  userId: string | null
  previousAssignee?: string | null
  bulkId?: string
}): Record<string, unknown> => ({
  inboxItemId: unbrand(NOTIF_TEST_IDS.inboxItemId),
  ...input,
  source: WEB_SOURCE,
})

export const escalatedPayload = (
  userId: string | null,
  source: string = WEB_SOURCE,
): Record<string, unknown> => ({
  inboxItemId: unbrand(NOTIF_TEST_IDS.inboxItemId),
  userId,
  source,
})

export const noteAddedPayload = (
  userId: string | null,
  source: string = WEB_SOURCE,
): Record<string, unknown> => ({
  inboxItemId: unbrand(NOTIF_TEST_IDS.inboxItemId),
  noteId: unbrand(NOTIF_TEST_IDS.noteId),
  userId,
  source,
})

/** A reply fact's payload; `authorId` is left out for a submission. */
export const replyPayload = (input: {
  userId: string | null
  authorId?: string
}): Record<string, unknown> => ({
  replyId: unbrand(NOTIF_TEST_IDS.replyId),
  reviewId: unbrand(NOTIF_TEST_IDS.reviewId),
  ...input,
  source: WEB_SOURCE,
})

export const publishFailedPayload = (
  authorId: string | null,
  extra: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> => ({
  replyId: unbrand(NOTIF_TEST_IDS.replyId),
  reviewId: unbrand(NOTIF_TEST_IDS.reviewId),
  authorId,
  ...extra,
})

export const firstJob = (deps: WorkflowTestDeps): QueuedNotice =>
  deps.fakes.jobs[0]!.data as QueuedNotice

export const renderedFor = (
  deps: WorkflowTestDeps,
  type: Parameters<typeof renderNotification>[0],
) => renderNotification(type, parseNotificationPayload(firstJob(deps).payload))

/** A recorded domain fact, carried through the outbox into a consumer event. */
export const recordedEvent = (
  fact: Parameters<typeof toOutboxEvent>[0] & { eventId: string },
): ConsumerEvent => {
  const row = toOutboxEvent(fact)
  return buildConsumerEvent({
    id: fact.eventId,
    eventType: row.eventType,
    eventVersion: row.eventVersion ?? 1,
    payload: row.payload,
    organizationId: row.organizationId,
    propertyId: row.propertyId ?? null,
    sourceContext: row.sourceContext,
    sourceAggregateId: row.sourceAggregateId,
    recordedAt: NOTIF_TEST_IDS.now,
  })
}
