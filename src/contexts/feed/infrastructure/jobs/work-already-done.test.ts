// A notice whose work was finished before it landed, or before its mail left.
//
// Settlement retires the rows that exist when the settling fact is handled.
// The insert-notification job runs on a slower, rate-limited queue, so an
// escalation resolved (or a reply approved) seconds after it was raised can
// be settled before its notice exists — and the late row then asked for work
// nobody was waiting on, urgent email included (N02, N06, N30, N47).

import { describe, expect, it, vi } from 'vitest'
import type { Job } from 'bullmq'
import { organizationId, propertyId, userId } from '#/shared/domain/ids'
import { buildFakeInsertNotificationDeps } from '../../application/use-cases/test-fixtures'
import type { NotificationWorkState } from '../../application/notification-work-state'
import { withOutboxNotificationDelivery } from '../outbox-notification-delivery'
import {
  createInsertNotificationHandler,
  type InsertNotificationJobData,
} from './insert-notification.job'
import { createUrgentEmailJobHandler, type UrgentEmailJobData } from './urgent-email.job'
import {
  loadItems,
  type DigestEntryDeps,
  type RecipientContext,
} from './digest-entry-selection'
import {
  buildNotification,
  buildNotificationEmail,
  createFakeJobLogger,
} from './test-fixtures'

const ORG = organizationId('org-1')
const PROPERTY = propertyId('11111111-1111-4111-8111-111111111111')
const NOW = new Date('2026-01-15T15:00:00.000Z')

const workState = (
  answer: Awaited<ReturnType<NotificationWorkState['isWaiting']>>,
): NotificationWorkState => ({
  isWaiting: vi.fn(async () => answer),
  finished: vi.fn(async ({ types }) => types),
})

const escalated: InsertNotificationJobData = {
  userId: userId('user-1'),
  organizationId: ORG,
  propertyId: PROPERTY,
  type: 'inbox.escalated',
  resourceType: 'inbox_item',
  resourceId: 'item-1',
  eventId: 'event-1',
  payload: { propertyName: 'Riverside Hotel', platform: 'google' },
  audience: {
    kind: 'responsible_scope',
    scope: { kind: 'property', propertyId: PROPERTY as string },
  },
}

async function durable(data: InsertNotificationJobData) {
  let captured: unknown
  await withOutboxNotificationDelivery(
    { add: vi.fn(async (_name, queued) => void (captured = queued)) },
    { insertReceipt: vi.fn(async () => {}) },
    {
      eventType: 'inbox.inbox_item.escalated',
      consumerName: 'notification.on-inbox-inbox_item-escalated',
    },
  ).add('insert-notification', data)
  return captured as InsertNotificationJobData
}

describe('a notice materialized after its work was done', () => {
  const deliverySettlement = () => ({
    settleAuthorized: vi.fn(async () => 'applied' as const),
    settleObsolete: vi.fn(async () => {}),
  })

  it('is settled as obsolete: no row and no email', async () => {
    const settlement = deliverySettlement()
    const work = workState(false)
    const handler = createInsertNotificationHandler({
      ...buildFakeInsertNotificationDeps(),
      authorizeAudience: vi.fn(async () => true),
      deliverySettlement: settlement,
      workState: work,
    })

    await handler({ data: await durable(escalated) } as Job<InsertNotificationJobData>)

    expect(work.isWaiting).toHaveBeenCalledWith({
      organizationId: ORG,
      type: 'inbox.escalated',
      resourceId: 'item-1',
      audience: escalated.audience,
    })
    expect(settlement.settleObsolete).toHaveBeenCalled()
    expect(settlement.settleAuthorized).not.toHaveBeenCalled()
  })

  it('is written while the work still waits', async () => {
    const settlement = deliverySettlement()
    const handler = createInsertNotificationHandler({
      ...buildFakeInsertNotificationDeps(),
      authorizeAudience: vi.fn(async () => true),
      deliverySettlement: settlement,
      workState: workState(true),
    })

    await handler({ data: await durable(escalated) } as Job<InsertNotificationJobData>)

    expect(settlement.settleAuthorized).toHaveBeenCalled()
  })
})

describe('an immediate email whose work was done after its row was written', () => {
  const entry = buildNotificationEmail({
    propertyId: PROPERTY as string,
    cadence: 'immediate',
    priority: 'urgent',
  })
  const row = buildNotification({
    propertyId: PROPERTY as string,
    type: 'reply.pending_approval',
    category: 'urgent_operational',
    priority: 'urgent',
    resourceType: 'inbox_item',
    resourceId: 'item-1',
    payload: { propertyName: 'Riverside Hotel', platform: 'google' },
  })

  const deps = (work: NotificationWorkState) => ({
    emailRepo: {
      findById: vi.fn(async () => entry),
      markSuppressed: vi.fn(async () => {}),
      markAttemptStarted: vi.fn(async () => {}),
      markAccepted: vi.fn(async () => {}),
      recordEmailUnsubscribeScope: vi.fn(async () => {}),
      isAddressSuppressed: vi.fn(async () => false),
    },
    preferenceRepo: {
      resolveForDelivery: vi.fn(async () => ({ enabled: true, cadence: 'immediate' })),
      resolveDeliveryWindow: vi.fn(async () => ({
        quietHoursStart: null,
        quietHoursEnd: null,
        urgentBypassEnabled: false,
      })),
      getUserSettings: vi.fn(async () => null),
    },
    notifRepo: { findByIdForProperty: vi.fn(async () => row) },
    userLookup: { getEmail: vi.fn(async () => 'manager@example.com') },
    emailSender: {
      send: vi.fn(async () => ({
        kind: 'accepted' as const,
        providerMessageId: 'provider-1',
        acceptedAt: NOW,
      })),
    },
    resolvePropertyScope: vi.fn(async () => ({
      organizationId: ORG as string,
      propertyId: PROPERTY as string,
      timezone: 'Europe/London',
    })),
    resolveOrganizationScope: vi.fn(async () => ({ timezone: 'Europe/London' })),
    authorizeScope: vi.fn(async () => true),
    organizationEmailStop: vi.fn(async () => 'none' as const),
    isRecipientEligible: vi.fn(async () => true),
    workState: work,
    logger: createFakeJobLogger(),
    clock: () => NOW,
    baseUrl: 'https://app.example.com',
    oneClickUnsubscribeUrl: () => 'https://app.example.com/unsubscribe',
  })

  const job = {
    data: {
      notificationEmailId: entry.id as string,
      organizationId: ORG as string,
      propertyId: PROPERTY as string,
    } as unknown as UrgentEmailJobData,
  }
  const run = (built: ReturnType<typeof deps>) =>
    createUrgentEmailJobHandler(
      built as unknown as Parameters<typeof createUrgentEmailJobHandler>[0],
    )(job)

  it('is retired, not sent, once the reply was decided', async () => {
    const built = deps(workState(false))

    await run(built)

    expect(built.emailSender.send).not.toHaveBeenCalled()
    expect(built.emailRepo.markSuppressed).toHaveBeenCalledWith(
      entry.id,
      ORG,
      PROPERTY,
      'work_no_longer_waiting',
      NOW,
    )
  })

  it('still goes out while the reply waits for approval', async () => {
    const built = deps(workState(true))

    await run(built)

    expect(built.emailSender.send).toHaveBeenCalledTimes(1)
  })
})

describe('a digest line whose work was done after its row was written', () => {
  const ctx = {
    orgId: ORG,
    userId: userId('user-1'),
    rawOrgId: ORG as string,
    now: NOW,
    timezone: 'UTC',
    timezoneSource: 'fallback',
    quietHours: { quietHoursStart: null, quietHoursEnd: null },
  } as unknown as RecipientContext
  const entry = buildNotificationEmail({ propertyId: PROPERTY as string })
  const row = buildNotification({
    propertyId: PROPERTY as string,
    type: 'inbox.escalated',
    resourceType: 'inbox_item',
    resourceId: 'item-1',
  })
  const deps = (work: NotificationWorkState) =>
    ({
      emailRepo: { markSuppressed: vi.fn(async () => {}), markDelayed: vi.fn() },
      preferenceRepo: { resolveForDelivery: vi.fn() },
      notifRepo: {
        findByIdsForProperty: vi.fn(async () => new Map([[row.id as string, row]])),
      },
      logger: createFakeJobLogger(),
      resolvePropertyScope: vi.fn(),
      authorizeScope: vi.fn(),
      isRecipientEligible: vi.fn(),
      workState: work,
    }) as unknown as DigestEntryDeps & {
      emailRepo: { markSuppressed: ReturnType<typeof vi.fn> }
    }

  it('is dropped with a visible reason', async () => {
    const built = deps(workState(false))

    const items = await loadItems(built, ctx, [entry])

    expect(items).toEqual([])
    expect(built.emailRepo.markSuppressed).toHaveBeenCalledWith(
      entry.id,
      ORG,
      PROPERTY,
      'work_no_longer_waiting',
      NOW,
    )
  })

  it('is kept while the escalation stands', async () => {
    const items = await loadItems(deps(workState(true)), ctx, [entry])

    expect(items).toHaveLength(1)
  })
})
