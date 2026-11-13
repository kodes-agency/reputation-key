// A grouped reopen is settled once none of its items still stands (N15).
//
// "5 items reopened at Hotel H" is filed under the first of its items, so a
// closed cycle cannot settle it by resource: the other four may still wait.
// Nothing settled it at all, so it counted in the unread badge forever and a
// deferred email still announced five reopened items after all five closed.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { notificationEmailQueue, notifications } from '#/shared/db/schema'
import {
  holdTransaction,
  type HeldTransaction,
} from '#/shared/db/testing/held-transaction'
import { seedProperty } from '#/shared/db/testing/notification-test-db'
import type { ConsumerEvent } from '#/shared/outbox'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import {
  inboxItemId,
  notificationId,
  organizationId,
  propertyId,
  type NotificationId,
} from '#/shared/domain/ids'
import type { Database } from '#/shared/db'
import { createMockLogger } from '#/shared/testing/mock-logger'
import { settleGroupedReopens } from './settle.server'
import { type NotificationWorkDecision } from '../domain/notification-actionable'
import { handleNotificationSettlementEvent } from '../infrastructure/notification-settlement-outbox-consumers'
import type { WaitingGroupedReopen } from '../application/ports/grouped-reopen-store.port'

const ORG = 'organization-grouped-reopen'
const RECIPIENT = 'recipient-grouped-reopen'
const PROPERTY = propertyId('99000000-0000-4000-8000-000000000001')
const OTHER_PROPERTY = '99000000-0000-4000-8000-0000000000ff'
const FIRST = inboxItemId('99000000-0000-4000-8000-000000000002')
const SECOND = inboxItemId('99000000-0000-4000-8000-000000000003')
const GROUPED = notificationId('99000000-0000-4000-8000-000000000005')
const SECOND_GROUPED = notificationId('99000000-0000-4000-8000-000000000006')
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
  db: Database,
  work: NotificationWorkDecision,
  rows: ReadonlyArray<WaitingGroupedReopen> = [waitingRow()],
) => ({
  db,
  groupedReopens: {
    findWaiting: vi.fn(async () => rows),
    settle: vi.fn(async (): Promise<ReadonlyArray<NotificationId>> => [GROUPED]),
  },
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

let held: HeldTransaction

const queuedMail = (notification: NotificationId) => ({
  id: `${notification.slice(0, -2)}1${notification.slice(-1)}`,
  notificationId: notification,
  userId: RECIPIENT,
  organizationId: ORG,
  propertyId: PROPERTY,
  category: 'workflow_collaboration' as const,
  cadence: 'daily' as const,
  status: 'pending' as const,
  priority: 'normal' as const,
  idempotencyKey: `grouped-reopen-${notification}`,
  nextAttemptAt: NOW,
})

const mailStatus = async (notification: NotificationId) => {
  const [row] = await held.db
    .select({
      status: notificationEmailQueue.status,
      reason: notificationEmailQueue.suppressionReason,
    })
    .from(notificationEmailQueue)
    .where(eq(notificationEmailQueue.notificationId, notification))
  return row
}

beforeAll(async () => {
  registerAllEventSchemas()
  held = await holdTransaction()
  await seedProperty(held.db, { id: PROPERTY, organizationId: ORG })
})

afterAll(async () => {
  await held?.rollBack()
})

beforeEach(async () => {
  await held.db
    .delete(notificationEmailQueue)
    .where(eq(notificationEmailQueue.organizationId, ORG))
  await held.db.delete(notifications).where(eq(notifications.organizationId, ORG))
  await held.db.insert(notifications).values(
    (
      [
        [GROUPED, FIRST],
        [SECOND_GROUPED, SECOND],
      ] as const
    ).map(([id, resource]) => ({
      id,
      userId: RECIPIENT,
      organizationId: ORG,
      propertyId: PROPERTY,
      type: 'inbox.bulk_reopened' as const,
      category: 'workflow_collaboration' as const,
      priority: 'normal' as const,
      status: 'unread' as const,
      resourceType: 'inbox_item' as const,
      resourceId: resource,
      eventId: id,
      title: 'Items reopened',
      payload: {},
      createdAt: OCCURRED_AT,
      updatedAt: OCCURRED_AT,
    })),
  )
  await held.db
    .insert(notificationEmailQueue)
    .values([queuedMail(GROUPED), queuedMail(SECOND_GROUPED)])
})

describe('a grouped reopen whose items have all closed', () => {
  it('is settled, and its queued mail cancelled', async () => {
    const deps = makeDeps(held.db, false)

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
    expect(await mailStatus(GROUPED)).toEqual({
      status: 'cancelled',
      reason: 'work_settled',
    })
  })
})

describe('a grouped reopen that still stands', () => {
  it('keeps waiting while any of its items is still open', async () => {
    const deps = makeDeps(held.db, { itemCount: 1 })

    await handleNotificationSettlementEvent(deps as never, closed())

    expect(deps.groupedReopens.settle).not.toHaveBeenCalled()
    expect((await mailStatus(GROUPED))?.status).toBe('pending')
  })

  it('keeps waiting when a later grouped reopen was folded into it', async () => {
    const deps = makeDeps(held.db, false, [waitingRow(2)])

    await handleNotificationSettlementEvent(deps as never, closed())

    // The row stands for items its first fact does not name.
    expect(deps.workState.isWaiting).not.toHaveBeenCalled()
    expect(deps.groupedReopens.settle).not.toHaveBeenCalled()
  })

  it.each([
    null,
    {},
    { reopened: [] },
    { reopened: [cycle(FIRST, OTHER_PROPERTY)] },
    { reopened: [{ propertyId: PROPERTY }] },
  ])(
    'keeps a row whose source cannot identify its Property cycles: %j',
    async (source) => {
      const deps = makeDeps(held.db, false, [{ ...waitingRow(), source }])
      await settleGroupedReopens(deps, {
        organizationId: organizationId(ORG),
        propertyId: PROPERTY,
        resolvedAt: NOW,
      })
      expect(deps.workState.isWaiting).not.toHaveBeenCalled()
      expect(deps.groupedReopens.settle).not.toHaveBeenCalled()
      expect((await mailStatus(GROUPED))?.status).toBe('pending')
    },
  )

  it('cancels mail only for rows that were still waiting when settlement ran', async () => {
    const second = SECOND_GROUPED
    const deps = makeDeps(held.db, false, [waitingRow(), { ...waitingRow(), id: second }])
    deps.groupedReopens.settle.mockResolvedValue([second])
    await expect(
      settleGroupedReopens(deps, {
        organizationId: organizationId(ORG),
        propertyId: PROPERTY,
        resolvedAt: NOW,
      }),
    ).resolves.toBe(1)
    expect(deps.groupedReopens.settle).toHaveBeenCalledWith({
      organizationId: ORG,
      ids: [GROUPED, second],
      resolvedAt: NOW,
    })
    expect((await mailStatus(second))?.status).toBe('cancelled')
    expect((await mailStatus(GROUPED))?.status).toBe('pending')
  })
})
