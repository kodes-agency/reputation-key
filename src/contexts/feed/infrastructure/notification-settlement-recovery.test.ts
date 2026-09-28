// "Reconnect Google" and "Guest portal needs attention" once the problem is
// gone (N24).
//
// Neither type ever settled. A reconnect by another admin left every other
// admin's "Reconnect Google" unread and its deferred email still went out at
// 07:00; a Portal whose Health recovered still appeared in the next morning's
// digest as "Its Google review destination is gone … Choose another".

import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { ConsumerEvent } from '#/shared/outbox'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { notificationId, propertyId, type NotificationId } from '#/shared/domain/ids'
import { createMockLogger } from '#/shared/testing/mock-logger'
import { isStillActionable } from '../domain/notification-settlement'
import { handleNotificationSettlementEvent } from './notification-settlement-outbox-consumers'
import { noGroupedReopens, waitingWorkState } from './jobs/test-fixtures'

const ORG = 'organization-recovery'
const PROPERTY = propertyId('97000000-0000-4000-8000-000000000001')
const PORTAL = '97000000-0000-4000-8000-000000000006'
const CONNECTION = '97000000-0000-4000-8000-000000000008'
const SETTLED = notificationId('97000000-0000-4000-8000-000000000005')
const NOW = new Date('2026-09-24T07:00:00.000Z')
const OCCURRED_AT = new Date('2026-09-23T23:30:00.000Z')

const makeDeps = () => ({
  notifications: {
    settleUnreadForResource: vi.fn(async (): Promise<ReadonlyArray<NotificationId>> => [
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

const googleFact = (
  eventType: string,
  eventVersion: number,
  payload: Record<string, unknown>,
): ConsumerEvent => ({
  eventId: '97000000-0000-4000-8000-0000000000aa',
  eventType,
  eventVersion,
  payload: { connectionId: CONNECTION, organizationId: ORG, ...payload },
  organizationId: ORG,
  propertyId: null,
  sourceContext: 'integration',
  sourceAggregateId: CONNECTION,
  occurredAt: OCCURRED_AT.toISOString(),
  recordedAt: OCCURRED_AT.toISOString(),
})

const health = (status: string, reason: string): ConsumerEvent => ({
  eventId: '97000000-0000-4000-8000-0000000000bb',
  eventType: 'portal.health.changed',
  eventVersion: 1,
  payload: {
    portalId: PORTAL,
    organizationId: ORG,
    propertyId: PROPERTY,
    previousStatus: 'degraded',
    previousReason: 'google_destination_unavailable',
    status,
    reason,
    sourceVersion: 'health-fence-2',
    occurredAt: OCCURRED_AT.toISOString(),
  },
  organizationId: ORG,
  propertyId: PROPERTY,
  sourceContext: 'portal',
  sourceAggregateId: PROPERTY,
  occurredAt: OCCURRED_AT.toISOString(),
  recordedAt: OCCURRED_AT.toISOString(),
})

beforeAll(() => {
  registerAllEventSchemas()
})

describe('a Google connection that works again', () => {
  it('retires every admin’s "Reconnect Google" once it is reconnected', async () => {
    const deps = makeDeps()

    await handleNotificationSettlementEvent(
      deps,
      googleFact('integration.google_account.connected', 3, { userId: 'admin-b' }),
    )

    expect(deps.notifications.settleUnreadForResource).toHaveBeenCalledWith({
      organizationId: ORG,
      types: ['integration.reauthorization_required'],
      resourceId: CONNECTION,
      resolvedAt: NOW,
    })
    expect(deps.emails.cancelQueuedForNotifications).toHaveBeenCalled()
  })

  it('retires it too when an admin disconnects instead', async () => {
    const deps = makeDeps()

    await handleNotificationSettlementEvent(
      deps,
      googleFact('integration.google_account.disconnected', 1, { userId: 'admin-b' }),
    )

    expect(deps.notifications.settleUnreadForResource).toHaveBeenCalledWith(
      expect.objectContaining({
        types: ['integration.reauthorization_required'],
        resourceId: CONNECTION,
      }),
    )
  })
})

describe('a Portal whose Health no longer needs a person', () => {
  it('retires "Guest portal needs attention" once Health recovers', async () => {
    const deps = makeDeps()

    await handleNotificationSettlementEvent(deps, health('healthy', 'operational'))

    expect(deps.notifications.settleUnreadForResource).toHaveBeenCalledWith({
      organizationId: ORG,
      types: ['portal.health_attention'],
      resourceId: PORTAL,
      resolvedAt: NOW,
    })
  })

  it('retires it when the Portal moves to a state nobody has to fix', async () => {
    const deps = makeDeps()

    await handleNotificationSettlementEvent(
      deps,
      health('unavailable', 'publication_disabled'),
    )

    expect(deps.notifications.settleUnreadForResource).toHaveBeenCalled()
  })

  it('leaves it waiting while Health still asks for a person', async () => {
    const deps = makeDeps()

    const outcome = await handleNotificationSettlementEvent(
      deps,
      health('degraded', 'public_address_unavailable'),
    )

    expect(deps.notifications.settleUnreadForResource).not.toHaveBeenCalled()
    expect(outcome).toEqual({ status: 'applied' })
  })
})

it('holds back the email of a settled reconnect or Health notice', () => {
  const settled = { status: 'unread' as const, readAt: null, resolvedAt: NOW }

  expect(
    isStillActionable({ ...settled, type: 'integration.reauthorization_required' }),
  ).toBe(false)
  expect(isStillActionable({ ...settled, type: 'portal.health_attention' })).toBe(false)
})
