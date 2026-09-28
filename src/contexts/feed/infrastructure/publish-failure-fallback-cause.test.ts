import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import type { ConsumerEvent } from '#/shared/outbox/consumer-registry'
import { unbrand } from '#/shared/domain/ids'
import { handleWorkflowNotificationEvent } from './workflow-outbox-consumers'
import {
  createNotificationConsumerDeps,
  NOTIF_TEST_IDS,
} from './notification-consumer-test-fixtures'
import { parseNotificationPayload } from '../domain/notification-payload'
import { renderNotification } from '../domain/notification-templates'

const EVENT_ID = '30000000-0000-4000-8000-000000000081'

const makeDeps = () => {
  const fakes = createNotificationConsumerDeps()
  fakes.userLookup.findByRole.mockResolvedValue([NOTIF_TEST_IDS.admin1])
  fakes.responsibleManagers.findForProperty.mockResolvedValue([NOTIF_TEST_IDS.manager1])
  // The author left the Property, so the notice falls back to its managers.
  fakes.responsibleManagers.isEligibleForProperty.mockResolvedValue(false)
  return {
    queue: fakes.queue,
    userLookup: fakes.userLookup,
    responsibleManagers: fakes.responsibleManagers,
    inboxItemLookup: fakes.inboxItemLookup,
    replyApproval: fakes.replyApproval,
    clock: fakes.clock,
    logger: fakes.logger,
    receipts: { insertReceipt: vi.fn(async () => {}) },
    fakes,
  }
}

const publishFailed = (): ConsumerEvent => ({
  eventId: EVENT_ID,
  eventType: 'review.reply.publish_failed',
  eventVersion: 1,
  payload: {
    organizationId: unbrand(NOTIF_TEST_IDS.orgId),
    propertyId: unbrand(NOTIF_TEST_IDS.propId),
    occurredAt: NOTIF_TEST_IDS.now.toISOString(),
    replyId: unbrand(NOTIF_TEST_IDS.replyId),
    reviewId: unbrand(NOTIF_TEST_IDS.reviewId),
    authorId: unbrand(NOTIF_TEST_IDS.authorId),
    outcome: 'not_sent',
    cause: 'google_reauthorization_required',
  },
  organizationId: unbrand(NOTIF_TEST_IDS.orgId),
  propertyId: unbrand(NOTIF_TEST_IDS.propId),
  sourceContext: 'review',
  sourceAggregateId: 'aggregate-1',
  occurredAt: NOTIF_TEST_IDS.now.toISOString(),
  recordedAt: NOTIF_TEST_IDS.now.toISOString(),
  correlationId: 'correlation-1',
})

// A retry cannot publish until Google is reconnected, and that is just as
// true when the notice reaches a responsible manager instead of the author.
describe('publish failure fallback to the responsible managers', () => {
  beforeEach(() => {
    clearEventSchemas()
    registerAllEventSchemas()
  })

  it('keeps the reconnect cause, so managers are not told to retry', async () => {
    const deps = makeDeps()

    await handleWorkflowNotificationEvent(deps, publishFailed())

    expect(deps.fakes.jobs).toHaveLength(1)
    const data = deps.fakes.jobs[0]!.data
    expect(data).toEqual(
      expect.objectContaining({
        userId: NOTIF_TEST_IDS.manager1,
        audience: expect.objectContaining({ kind: 'responsible_scope' }),
      }),
    )
    const rendered = renderNotification(
      'reply.publish_failed',
      parseNotificationPayload(data.payload),
    )
    expect(rendered.body).toContain('reconnect')
    expect(rendered.actionLabel).not.toBe('Retry publish')
  })
})
