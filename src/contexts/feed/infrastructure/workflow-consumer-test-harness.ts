// A small harness for the focused workflow-consumer suites: the fakes, one
// envelope builder, and the queued jobs read back. The long route suite keeps
// its own copy; this one exists so a new audience rule gets a short file of
// its own instead of growing that one.

import { vi } from 'vitest'
import type { ConsumerEvent } from '#/shared/outbox/consumer-registry'
import { unbrand } from '#/shared/domain/ids'
import type {
  WORKFLOW_NOTIFICATION_CONSUMERS,
  WorkflowNotificationConsumerDeps,
} from './workflow-outbox-consumers'
import {
  createNotificationConsumerDeps,
  NOTIF_TEST_IDS,
  type FakeNotificationConsumerDeps,
} from './notification-consumer-test-fixtures'
import type { InsertNotificationJobData } from './jobs/insert-notification.job'

export type WorkflowTestDeps = WorkflowNotificationConsumerDeps & {
  fakes: FakeNotificationConsumerDeps
}

/** One AccountAdmin and one responsible manager, both eligible, as a start. */
export const makeWorkflowDeps = (): WorkflowTestDeps => {
  const fakes = createNotificationConsumerDeps()
  fakes.userLookup.findByRole.mockResolvedValue([NOTIF_TEST_IDS.admin1])
  fakes.responsibleManagers.findForProperty.mockResolvedValue([NOTIF_TEST_IDS.manager1])
  fakes.responsibleManagers.isEligibleForProperty.mockResolvedValue(true)
  return {
    queue: fakes.queue,
    userLookup: fakes.userLookup,
    responsibleManagers: fakes.responsibleManagers,
    inboxItemLookup: fakes.inboxItemLookup,
    replyApproval: fakes.replyApproval,
    activeProperty: fakes.activeProperty,
    retireMovedAssignment: fakes.retireMovedAssignment,
    clock: fakes.clock,
    logger: fakes.logger,
    receipts: { insertReceipt: vi.fn(async () => {}) },
    fakes,
  }
}

export const workflowEvent = (
  eventType: (typeof WORKFLOW_NOTIFICATION_CONSUMERS)[number]['eventType'],
  payload: Readonly<Record<string, unknown>>,
  overrides: Partial<ConsumerEvent> = {},
): ConsumerEvent => ({
  eventId: '30000000-0000-4000-8000-000000000009',
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

export const queuedJobs = (
  deps: WorkflowTestDeps,
): readonly InsertNotificationJobData[] =>
  deps.fakes.jobs.map((job) => job.data as InsertNotificationJobData)
