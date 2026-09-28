// Archiving a Property (N70).
//
// Archiving cancels the Property's queued publications with cause `policy`.
// The fan-out meant to leave out the approvers a policy cancellation took the
// authority from, but it asked Property eligibility, which ignores the
// lifecycle: every AccountAdmin — the one who archived included — and the
// author were told to approve a reply again that nobody can approve on an
// archived Property. And the Property's notices still asking for work kept
// counting in the unread badge, with nothing to settle them.

import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { ConsumerEvent } from '#/shared/outbox'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { notificationId, unbrand, type NotificationId } from '#/shared/domain/ids'
import { createMockLogger } from '#/shared/testing/mock-logger'
import {
  createNotificationConsumerDeps,
  NOTIF_TEST_IDS,
} from './notification-consumer-test-fixtures'
import { handleWorkflowNotificationEvent } from './workflow-outbox-consumers'
import { handleNotificationSettlementEvent } from './notification-settlement-outbox-consumers'
import { noGroupedReopens, waitingWorkState } from './jobs/test-fixtures'

const PROPERTY = '30000000-0000-4000-8000-0000000000c3'
const NOW = new Date('2026-09-24T07:00:00.000Z')

beforeAll(() => {
  registerAllEventSchemas()
})

const envelope = (
  eventType: string,
  payload: Record<string, unknown>,
): ConsumerEvent => ({
  eventId: '30000000-0000-4000-8000-0000000000aa',
  eventType,
  eventVersion: 1,
  payload: {
    organizationId: unbrand(NOTIF_TEST_IDS.orgId),
    propertyId: PROPERTY,
    occurredAt: NOTIF_TEST_IDS.now.toISOString(),
    ...payload,
  },
  organizationId: unbrand(NOTIF_TEST_IDS.orgId),
  propertyId: PROPERTY,
  sourceContext: eventType.split('.')[0]!,
  sourceAggregateId: PROPERTY,
  occurredAt: NOTIF_TEST_IDS.now.toISOString(),
  recordedAt: NOTIF_TEST_IDS.now.toISOString(),
})

describe('a publication the archive cancelled', () => {
  const workflowDeps = (active: boolean) => {
    const fakes = createNotificationConsumerDeps()
    fakes.userLookup.findByRole.mockResolvedValue([
      NOTIF_TEST_IDS.admin1,
      NOTIF_TEST_IDS.admin2,
    ])
    // Property eligibility ignores the lifecycle: every admin still passes.
    fakes.responsibleManagers.isEligibleForProperty.mockResolvedValue(true)
    fakes.activeProperty.mockResolvedValue(active)
    return {
      ...fakes,
      receipts: { insertReceipt: vi.fn(async () => undefined) },
    }
  }
  const cancelled = () =>
    envelope('review.reply.publication_cancelled', {
      replyId: '30000000-0000-4000-8000-0000000000c1',
      reviewId: '30000000-0000-4000-8000-0000000000c2',
      authorId: unbrand(NOTIF_TEST_IDS.authorId),
      cause: 'policy',
    })

  it('asks nobody to approve again on an archived Property', async () => {
    const deps = workflowDeps(false)

    await handleWorkflowNotificationEvent(deps, cancelled())

    expect(deps.jobs).toEqual([])
    expect(deps.receipts.insertReceipt).toHaveBeenCalled()
  })

  it('still tells the author and the approvers while the Property is active', async () => {
    const deps = workflowDeps(true)

    await handleWorkflowNotificationEvent(deps, cancelled())

    expect(deps.jobs).toHaveLength(3)
  })
})

describe('the notices still asking for work on an archived Property', () => {
  const SETTLED = notificationId('30000000-0000-4000-8000-0000000000d1')
  const settlementDeps = () => ({
    notifications: {
      settleUnreadForResource: vi.fn(
        async (): Promise<ReadonlyArray<NotificationId>> => [],
      ),
      settleUnreadForProperty: vi.fn(async (): Promise<ReadonlyArray<NotificationId>> => [
        SETTLED,
      ]),
    },
    groupedReopens: noGroupedReopens(),
    emails: { cancelQueuedForNotifications: vi.fn(async () => 1) },
    inboxItemLookup: { findInboxItemByReviewId: vi.fn(async () => null) },
    workState: waitingWorkState(),
    clock: () => NOW,
    logger: createMockLogger(),
    receipts: { insertReceipt: vi.fn(async () => undefined) },
  })

  it('are settled, all of them, and their mail cancelled', async () => {
    const deps = settlementDeps()

    await handleNotificationSettlementEvent(
      deps,
      envelope('property.archived', {
        userId: unbrand(NOTIF_TEST_IDS.admin1),
        previousState: 'active',
        sourceEpoch: 1,
        recoveryDeadline: '2026-10-24T07:00:00.000Z',
      }),
    )

    const [input] = deps.notifications.settleUnreadForProperty.mock.calls[0] as never as [
      { organizationId: string; propertyId: string; types: ReadonlyArray<string> },
    ]
    expect(input).toMatchObject({
      organizationId: NOTIF_TEST_IDS.orgId,
      propertyId: PROPERTY,
    })
    expect(input.types).toEqual(
      expect.arrayContaining([
        'reply.pending_approval',
        'inbox.escalated',
        'review.created',
      ]),
    )
    // The Google connection is the Organization's; the Property only anchored
    // its notice, so archiving it answers nothing.
    expect(input.types).not.toContain('integration.reauthorization_required')
    expect(deps.emails.cancelQueuedForNotifications).toHaveBeenCalledWith(
      [SETTLED],
      NOTIF_TEST_IDS.orgId,
      'work_settled',
      NOW,
    )
  })
})
