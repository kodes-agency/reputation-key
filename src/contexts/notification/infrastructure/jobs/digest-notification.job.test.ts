import { describe, expect, it, vi } from 'vitest'
import type { Job } from 'bullmq'
import { createDigestNotificationJobHandler } from './digest-notification.job'
import {
  notificationEmailId,
  notificationId,
  organizationId,
  propertyId,
  userId,
  type NotificationId,
  type PropertyId,
} from '#/shared/domain/ids'
import type { Notification, NotificationEmail } from '../../domain/types'

const NOW = new Date('2026-07-11T08:00:00.000Z')

function emailFor(property: string): NotificationEmail {
  return {
    id: notificationEmailId(`email-${property}`),
    notificationId: notificationId(`notification-${property}`),
    userId: userId('user-1'),
    organizationId: organizationId('org-1'),
    propertyId: propertyId(property),
    category: 'digest_summary',
    cadence: 'daily',
    status: 'pending',
    priority: 'normal',
    idempotencyKey: `notification-${property}:email`,
    providerMessageId: null,
    providerState: null,
    lastErrorClass: null,
    suppressionReason: null,
    notBefore: null,
    nextAttemptAt: null,
    attemptedAt: null,
    acceptedAt: null,
    deliveredAt: null,
    bouncedAt: null,
    sentAt: null,
    failedAt: null,
    retryCount: 0,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

function notificationFor(email: NotificationEmail): Notification {
  return {
    id: email.notificationId,
    userId: email.userId,
    organizationId: email.organizationId,
    propertyId: email.propertyId,
    type: 'goal.completed',
    category: 'digest_summary',
    priority: 'normal',
    status: 'unread',
    resourceType: 'goal',
    resourceId: 'goal-1',
    eventId: `event-${email.propertyId}`,
    title: 'Goal progress',
    body: null,
    readAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

function baseDeps(scopes: readonly Record<string, string>[]) {
  const findDueByProperty = vi.fn(async (_orgId, property) => [
    emailFor(property as string),
  ])
  const send = vi.fn(
    async (_params: {
      to: string
      subject: string
      html: string
      idempotencyKey: string
    }) => ({
      kind: 'accepted' as const,
      providerMessageId: crypto.randomUUID(),
      acceptedAt: NOW,
    }),
  )
  return {
    pool: { query: vi.fn(async () => ({ rows: scopes })) },
    emailRepo: {
      findDueByProperty,
      markSuppressed: vi.fn(async () => {}),
      markDelayed: vi.fn(async () => {}),
      markAccepted: vi.fn(async () => {}),
      markFailed: vi.fn(async () => {}),
    },
    preferenceRepo: {
      findForDelivery: vi.fn(async () => ({
        enabled: true,
        quietHoursStart: null,
        quietHoursEnd: null,
      })),
    },
    notifRepo: {
      findByIdsForProperty: vi.fn(
        async (ids: readonly NotificationId[], _org: unknown, property: PropertyId) => {
          const email = emailFor(property as string)
          return new Map(ids.map((id) => [id as string, notificationFor(email)]))
        },
      ),
    },
    userLookup: { getEmail: vi.fn(async () => 'manager@example.com') },
    emailSender: { send },
    logger: { error: vi.fn() },
    clock: () => NOW,
    authorizeScope: vi.fn(async () => true),
    enqueueImmediate: vi.fn(async () => {}),
  }
}

describe('digest notification job', () => {
  it('authorizes each concrete property before reading its delivery rows', async () => {
    const deps = baseDeps([
      {
        organization_id: 'org-1',
        property_id: '11111111-1111-4111-8111-111111111111',
        timezone: 'UTC',
      },
    ])
    deps.authorizeScope.mockResolvedValue(false)
    const handler = createDigestNotificationJobHandler(
      deps as unknown as Parameters<typeof createDigestNotificationJobHandler>[0],
    )

    await handler({} as Job<void>)

    expect(deps.authorizeScope).toHaveBeenCalledWith(
      'org-1',
      '11111111-1111-4111-8111-111111111111',
    )
    expect(deps.emailRepo.findDueByProperty).not.toHaveBeenCalled()
    expect(deps.emailSender.send).not.toHaveBeenCalled()
  })

  it('never combines daily digests from different properties', async () => {
    const deps = baseDeps([
      {
        organization_id: 'org-1',
        property_id: '11111111-1111-4111-8111-111111111111',
        timezone: 'UTC',
      },
      {
        organization_id: 'org-1',
        property_id: '22222222-2222-4222-8222-222222222222',
        timezone: 'UTC',
      },
    ])
    const handler = createDigestNotificationJobHandler(
      deps as unknown as Parameters<typeof createDigestNotificationJobHandler>[0],
    )

    await handler({} as Job<void>)

    expect(deps.emailSender.send).toHaveBeenCalledTimes(2)
    const keys = deps.emailSender.send.mock.calls.map(([call]) => call.idempotencyKey)
    expect(keys).toEqual(
      expect.arrayContaining([
        expect.stringContaining('11111111-1111-4111-8111-111111111111'),
        expect.stringContaining('22222222-2222-4222-8222-222222222222'),
      ]),
    )
  })
})
