// A grouped reopen is settled once none of its items still stands (N15).
//
// "5 items reopened at Hotel H" is filed under the first of its items, so a
// closed cycle cannot settle it by resource: the other four may still wait.
// Nothing settled it at all, so it counted in the unread badge forever and a
// deferred email still announced five reopened items after all five closed.

import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { ConsumerEvent } from '#/shared/outbox'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import {
  inboxItemId,
  notificationId,
  propertyId,
  type NotificationId,
} from '#/shared/domain/ids'
import { createMockLogger } from '#/shared/testing/mock-logger'
import type { NotificationWorkDecision } from '../application/notification-work-state'
import { handleNotificationSettlementEvent } from './notification-settlement-outbox-consumers'

const ORG = 'organization-grouped-reopen'
const PROPERTY = propertyId('99000000-0000-4000-8000-000000000001')
const OTHER_PROPERTY = '99000000-0000-4000-8000-0000000000ff'
const FIRST = inboxItemId('99000000-0000-4000-8000-000000000002')
const SECOND = inboxItemId('99000000-0000-4000-8000-000000000003')
const GROUPED = notificationId('99000000-0000-4000-8000-000000000005')
const ACTOR = 'actor-grouped-reopen'
const NOW = new Date('2026-09-24T07:00:00.000Z')
const OCCURRED_AT = new Date('2026-09-24T02:00:00.000Z')

const cycle = (inboxItem: string, property: string = PROPERTY) => ({
  inboxItemId: inboxItem,
  propertyId: property,
  sourceType: 'review',
  sourceId: `${inboxItem.slice(0, -1)}9`,
  cycleNumber: 2,
  sourceRevision: 1,
  stateRevision: 3,
})

const waitingRow = (coalescedCount = 1) => ({
  id: GROUPED,
  coalescedCount,
  source: {
    organizationId: ORG,
    userId: ACTOR,
    bulkId: 'bulk-grouped-reopen',
    reopened: [cycle(FIRST), cycle(SECOND), cycle(FIRST, OTHER_PROPERTY)],
    count: 3,
  },
})

const makeDeps = (
  work: NotificationWorkDecision,
  rows: ReadonlyArray<ReturnType<typeof waitingRow>> = [waitingRow()],
) => ({
  notifications: {
    settleUnreadForProperty: vi.fn(
      async (): Promise<ReadonlyArray<NotificationId>> => [],
    ),
    settleUnreadForResource: vi.fn(
      async (): Promise<ReadonlyArray<NotificationId>> => [],
    ),
  },
  groupedReopens: {
    findWaiting: vi.fn(async () => rows),
    settle: vi.fn(async (): Promise<ReadonlyArray<NotificationId>> => [GROUPED]),
  },
  emails: { cancelQueuedForNotifications: vi.fn(async () => 1) },
  inboxItemLookup: { findInboxItemByReviewId: vi.fn(async () => null) },
  workState: {
    isWaiting: vi.fn(async () => work),
    finished: vi.fn(async ({ types }: { types: ReadonlyArray<string> }) => types),
  },
  clock: () => NOW,
  logger: createMockLogger(),
  receipts: { insertReceipt: vi.fn(async () => undefined) },
})

const closed = (): ConsumerEvent => ({
  eventId: '99000000-0000-4000-8000-0000000000aa',
  eventType: 'inbox.handling_cycle.closed',
  eventVersion: 1,
  payload: {
    ...cycle(SECOND),
    organizationId: ORG,
    actorType: 'provider',
    userId: null,
    triggerEventId: null,
    closeReason: 'confirmed_on_google',
    source: 'web',
    occurredAt: OCCURRED_AT.toISOString(),
  },
  organizationId: ORG,
  propertyId: PROPERTY,
  sourceContext: 'inbox',
  sourceAggregateId: SECOND,
  occurredAt: OCCURRED_AT.toISOString(),
  recordedAt: OCCURRED_AT.toISOString(),
})

beforeAll(() => {
  registerAllEventSchemas()
})

describe('a grouped reopen whose items have all closed', () => {
  it('is settled, and its queued mail cancelled', async () => {
    const deps = makeDeps(false)

    await handleNotificationSettlementEvent(deps as never, closed())

    expect(deps.groupedReopens.findWaiting).toHaveBeenCalledWith({
      organizationId: ORG,
      propertyId: PROPERTY,
    })
    // Asked about the cycles on this Property only, as the notice was grouped.
    expect(deps.workState.isWaiting).toHaveBeenCalledWith({
      organizationId: ORG,
      type: 'inbox.bulk_reopened',
      resourceId: FIRST,
      audience: {
        kind: 'bulk_handling_cycle',
        cycles: [cycle(FIRST), cycle(SECOND)].map(({ propertyId: _p, ...ref }) => ref),
        actorUserId: ACTOR,
      },
    })
    expect(deps.groupedReopens.settle).toHaveBeenCalledWith({
      organizationId: ORG,
      ids: [GROUPED],
      resolvedAt: NOW,
    })
    expect(deps.emails.cancelQueuedForNotifications).toHaveBeenCalledWith(
      [GROUPED],
      ORG,
      'work_settled',
      NOW,
    )
  })
})

describe('a grouped reopen that still stands', () => {
  it('keeps waiting while any of its items is still open', async () => {
    const deps = makeDeps({ itemCount: 1 })

    await handleNotificationSettlementEvent(deps as never, closed())

    expect(deps.groupedReopens.settle).not.toHaveBeenCalled()
  })

  it('keeps waiting when a later grouped reopen was folded into it', async () => {
    const deps = makeDeps(false, [waitingRow(2)])

    await handleNotificationSettlementEvent(deps as never, closed())

    // The row stands for items its first fact does not name.
    expect(deps.workState.isWaiting).not.toHaveBeenCalled()
    expect(deps.groupedReopens.settle).not.toHaveBeenCalled()
  })
})
