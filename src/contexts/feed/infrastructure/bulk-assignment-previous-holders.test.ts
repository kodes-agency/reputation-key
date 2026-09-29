// Who hears that a bulk reassignment took their items (I15).
//
// Reassigning one item tells whoever held it before. Doing the same to twelve
// items at once used to tell them nothing: the per-item facts are history
// only, and the grouped completion fact told the new assignee alone.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConsumerEvent } from '#/shared/outbox/consumer-registry'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { createNotificationConsumerDeps } from './notification-consumer-test-fixtures'
import { handleNotificationBulkAssignmentCompleted } from './bulk-assignment-outbox-consumers'
import type { InsertNotificationJobData } from './jobs/insert-notification.job'
import { parseNotificationPayload } from '../domain/notification-payload'
import { notificationLink, renderNotification } from '../domain/notification-templates'

const EVENT_ID = '91000000-0000-4000-8000-000000000001'
const ORG = '91000000-0000-4000-8000-000000000002'
const ACTOR = 'better-auth_actor-bulk-holders'
const NEXT = 'better-auth_next-bulk-holders'
const HOLDER = 'better-auth_holder-bulk-holders'
const OTHER_HOLDER = 'better-auth_other-holder-bulk-holders'
const PROPERTY_A = '91000000-0000-4000-8000-000000000006'
const PROPERTY_B = '91000000-0000-4000-8000-000000000007'
const ITEM_1 = '91000000-0000-4000-8000-000000000011'
const ITEM_2 = '91000000-0000-4000-8000-000000000012'
const ITEM_3 = '91000000-0000-4000-8000-000000000013'
const ITEM_4 = '91000000-0000-4000-8000-000000000014'

type Transition = Readonly<{
  inboxItemId: string
  propertyId: string
  previousAssignee: string | null
  nextAssignee: string | null
}>

const completed = (transitions: ReadonlyArray<Transition>): ConsumerEvent => ({
  eventId: EVENT_ID,
  eventType: 'inbox.inbox_items.bulk_assignment_completed',
  eventVersion: 1,
  payload: {
    organizationId: ORG,
    userId: ACTOR,
    bulkId: '91000000-0000-4000-8000-000000000005',
    transitions,
    count: transitions.length,
    source: 'web',
    occurredAt: '2026-09-20T12:00:00.000Z',
  },
  organizationId: ORG,
  propertyId: null,
  sourceContext: 'inbox',
  sourceAggregateId: '91000000-0000-4000-8000-000000000005',
  recordedAt: '2026-09-20T12:00:00.000Z',
})

const moved = (
  inboxItemId: string,
  propertyId: string,
  previousAssignee: string | null,
  nextAssignee: string | null = NEXT,
): Transition => ({ inboxItemId, propertyId, previousAssignee, nextAssignee })

const makeDeps = () => {
  const fakes = createNotificationConsumerDeps()
  fakes.displayNames.findPropertyName.mockResolvedValue('Riverside Hotel')
  return {
    queue: fakes.queue,
    userLookup: fakes.userLookup,
    displayNames: fakes.displayNames,
    logger: fakes.logger,
    receipts: { insertReceipt: vi.fn(async () => {}) },
    fakes,
  }
}

const unassignedNotices = (deps: ReturnType<typeof makeDeps>) =>
  deps.fakes.jobs
    .filter(
      (job) => (job.data as InsertNotificationJobData).type === 'inbox.bulk_unassigned',
    )
    .map((job) => ({ data: job.data, opts: job.opts }))

describe('a bulk reassignment and the people who held the items', () => {
  beforeEach(() => {
    clearEventSchemas()
    registerAllEventSchemas()
  })
  afterEach(() => clearEventSchemas())

  it('tells the previous holder once per Property, with how many moved', async () => {
    const deps = makeDeps()

    await handleNotificationBulkAssignmentCompleted(
      deps,
      completed([
        moved(ITEM_1, PROPERTY_A, HOLDER),
        moved(ITEM_2, PROPERTY_A, HOLDER),
        moved(ITEM_3, PROPERTY_B, HOLDER),
      ]),
    )

    expect(unassignedNotices(deps)).toEqual([
      {
        data: expect.objectContaining({
          userId: HOLDER,
          propertyId: PROPERTY_A,
          type: 'inbox.bulk_unassigned',
          resourceType: 'inbox_item',
          resourceId: ITEM_1,
          payload: {
            propertyName: 'Riverside Hotel',
            itemCount: 2,
            actorRole: 'property_manager',
          },
          // No longer the assignee, but may still act on the Property.
          audience: { kind: 'property_operator' },
        }),
        opts: { jobId: `${EVENT_ID}-${HOLDER}-${PROPERTY_A}-unassigned` },
      },
      {
        data: expect.objectContaining({
          userId: HOLDER,
          propertyId: PROPERTY_B,
          resourceId: ITEM_3,
          payload: expect.objectContaining({ itemCount: 1 }),
        }),
        opts: { jobId: `${EVENT_ID}-${HOLDER}-${PROPERTY_B}-unassigned` },
      },
    ])
  })

  it('tells each previous holder about their own items only', async () => {
    const deps = makeDeps()

    await handleNotificationBulkAssignmentCompleted(
      deps,
      completed([
        moved(ITEM_1, PROPERTY_A, HOLDER),
        moved(ITEM_2, PROPERTY_A, OTHER_HOLDER),
        moved(ITEM_3, PROPERTY_A, OTHER_HOLDER),
      ]),
    )

    expect(
      unassignedNotices(deps).map(({ data }) => {
        const job = data as InsertNotificationJobData
        return [job.userId, (job.payload as { itemCount: number }).itemCount]
      }),
    ).toEqual([
      [HOLDER, 1],
      [OTHER_HOLDER, 2],
    ])
  })

  // "Take these over": the actor is the new assignee and needs no notice,
  // but the person whose items they took still does.
  it('tells the previous holder when the actor takes the items over', async () => {
    const deps = makeDeps()

    await handleNotificationBulkAssignmentCompleted(
      deps,
      completed([
        moved(ITEM_1, PROPERTY_A, HOLDER, ACTOR),
        moved(ITEM_2, PROPERTY_A, HOLDER, ACTOR),
      ]),
    )

    expect(
      deps.fakes.jobs.map((job) => (job.data as InsertNotificationJobData).type),
    ).toEqual(['inbox.bulk_unassigned'])
    expect(unassignedNotices(deps)[0]!.data).toMatchObject({
      userId: HOLDER,
      payload: { itemCount: 2 },
    })
  })

  it('tells nobody about items that had no holder or that the actor held', async () => {
    const deps = makeDeps()

    await handleNotificationBulkAssignmentCompleted(
      deps,
      completed([
        moved(ITEM_1, PROPERTY_A, null),
        moved(ITEM_2, PROPERTY_A, ACTOR),
        moved(ITEM_4, PROPERTY_B, null),
      ]),
    )

    expect(unassignedNotices(deps)).toEqual([])
  })

  // A bulk release carries no new holder, like an eligibility-loss release,
  // and stays silent as a single-item release does.
  it('stays silent on a bulk release', async () => {
    const deps = makeDeps()

    await handleNotificationBulkAssignmentCompleted(
      deps,
      completed([moved(ITEM_1, PROPERTY_A, HOLDER, null)]),
    )

    expect(deps.fakes.jobs).toEqual([])
  })

  // Like the single notice, it never names who holds the items now.
  it('says how many moved and opens the Property’s open queue', async () => {
    const deps = makeDeps()
    await handleNotificationBulkAssignmentCompleted(
      deps,
      completed([moved(ITEM_1, PROPERTY_A, HOLDER), moved(ITEM_2, PROPERTY_A, HOLDER)]),
    )
    const job = unassignedNotices(deps)[0]!.data as InsertNotificationJobData

    expect(
      renderNotification('inbox.bulk_unassigned', parseNotificationPayload(job.payload)),
    ).toMatchObject({
      title: '2 items no longer yours at Riverside Hotel',
      body: 'A property manager reassigned 2 items you held to somebody else.',
    })
    expect(
      notificationLink('inbox_item', ITEM_1, PROPERTY_A, 'inbox.bulk_unassigned'),
    ).toEqual({ path: '/inbox', search: { queue: 'open', propertyId: PROPERTY_A } })
  })
})
