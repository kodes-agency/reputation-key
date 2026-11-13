// Archiving a Property (N70): the approvers it asks.
//
// Archiving cancels the Property's queued publications with cause `policy`.
// The fan-out meant to leave out the approvers a policy cancellation took the
// authority from, but it asked Property eligibility, which ignores the
// lifecycle: every AccountAdmin — the one who archived included — and the
// author were told to approve a reply again that nobody can approve on an
// archived Property.

import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { ConsumerEvent } from '#/shared/outbox'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { unbrand } from '#/shared/domain/ids'
import {
  createNotificationConsumerDeps,
  noticeWriterOver,
  NOTIF_TEST_IDS,
} from './notification-consumer-test-fixtures'
import { handleWorkflowNotificationEvent } from '../notify/inbox-workflow.server'

const PROPERTY = '30000000-0000-4000-8000-0000000000c3'

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
    const receipts = { insertReceipt: vi.fn(async () => undefined) }
    return {
      ...fakes,
      receipts,
      noticeWriter: noticeWriterOver({ add: fakes.addMock }, receipts),
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
