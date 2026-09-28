// A cancelled purge withdraws its final deletion warning (N45).
//
// "Final notice: permanent deletion … Deletion can start at any time" stayed
// unread and urgent after support cancelled the purge, and a mandatory email
// still waiting on a provider retry or the orphan sweep went out afterwards.

import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { ConsumerEvent } from '#/shared/outbox'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { notificationId, type NotificationId } from '#/shared/domain/ids'
import { createMockLogger } from '#/shared/testing/mock-logger'
import { isStillActionable } from '../domain/notification-settlement'
import { handleNotificationSettlementEvent } from './notification-settlement-outbox-consumers'
import { waitingWorkState } from './jobs/test-fixtures'

const ORG = 'organization-purge-cancelled'
const SETTLED = notificationId('98000000-0000-4000-8000-000000000005')
const NOW = new Date('2026-09-24T07:00:00.000Z')
const OCCURRED_AT = new Date('2026-09-23T23:30:00.000Z')

const makeDeps = () => ({
  notifications: {
    settleUnreadForResource: vi.fn(async (): Promise<ReadonlyArray<NotificationId>> => [
      SETTLED,
    ]),
  },
  emails: { cancelQueuedForNotifications: vi.fn(async () => 1) },
  inboxItemLookup: { findInboxItemByReviewId: vi.fn(async () => null) },
  workState: waitingWorkState(),
  clock: () => NOW,
  logger: createMockLogger(),
  receipts: { insertReceipt: vi.fn(async () => undefined) },
})

const lifecycle = (state: string): ConsumerEvent => ({
  eventId: '98000000-0000-4000-8000-0000000000aa',
  eventType: 'identity.organization_lifecycle.changed',
  eventVersion: 1,
  payload: {
    organizationId: ORG,
    closureLineageId: '98000000-0000-4000-8000-000000000009',
    state,
    revision: 4,
    reactivationRequired: true,
    recoverableUntil: '2026-10-02T09:00:00.000Z',
    occurredAt: OCCURRED_AT.toISOString(),
  },
  organizationId: ORG,
  propertyId: null,
  sourceContext: 'identity',
  sourceAggregateId: ORG,
  occurredAt: OCCURRED_AT.toISOString(),
  recordedAt: OCCURRED_AT.toISOString(),
})

beforeAll(() => {
  registerAllEventSchemas()
})

describe('a purge cancelled before the irreversible step', () => {
  it('withdraws every admin’s final deletion warning and its queued mail', async () => {
    const deps = makeDeps()

    await handleNotificationSettlementEvent(deps, lifecycle('active'))

    expect(deps.notifications.settleUnreadForResource).toHaveBeenCalledWith({
      organizationId: ORG,
      types: ['account.organization_purge_pending'],
      resourceId: ORG,
      resolvedAt: NOW,
    })
    expect(deps.emails.cancelQueuedForNotifications).toHaveBeenCalledWith(
      [SETTLED],
      ORG,
      'purge_cancelled',
      NOW,
    )
  })

  it('leaves the warning alone on any other lifecycle step', async () => {
    const deps = makeDeps()

    const outcome = await handleNotificationSettlementEvent(deps, lifecycle('purging'))

    expect(deps.notifications.settleUnreadForResource).not.toHaveBeenCalled()
    expect(outcome).toEqual({ status: 'applied' })
  })
})

describe('the warning’s mandatory email', () => {
  const warning = { type: 'account.organization_purge_pending' as const }

  it('is not sent once the warning is withdrawn', () => {
    expect(
      isStillActionable({ ...warning, status: 'unread', readAt: null, resolvedAt: NOW }),
    ).toBe(false)
  })

  it('is still owed to an admin who read the warning in the app', () => {
    expect(
      isStillActionable({ ...warning, status: 'read', readAt: NOW, resolvedAt: null }),
    ).toBe(true)
  })
})
