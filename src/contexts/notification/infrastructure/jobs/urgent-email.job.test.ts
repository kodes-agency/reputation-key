import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createUrgentEmailJobHandler, type UrgentEmailJobData } from './urgent-email.job'
import {
  notificationEmailId,
  notificationId,
  organizationId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import type { Notification, NotificationEmail } from '../../domain/types'
import type { NotificationDeliveryOutcome } from '../../domain/notification-delivery-policy'

const NOW = new Date('2026-01-15T15:00:00.000Z')
const ORG = organizationId('org-1')
const PROPERTY = propertyId('11111111-1111-4111-8111-111111111111')
const EMAIL_ID = notificationEmailId('email-1')
const entry: NotificationEmail = {
  id: EMAIL_ID,
  notificationId: notificationId('notification-1'),
  userId: userId('user-1'),
  organizationId: ORG,
  propertyId: PROPERTY,
  category: 'urgent_operational',
  cadence: 'immediate',
  status: 'pending',
  priority: 'urgent',
  idempotencyKey: 'notification-1:email',
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
const notification: Notification = {
  id: entry.notificationId,
  userId: entry.userId,
  organizationId: ORG,
  propertyId: PROPERTY,
  type: 'reply.publish_failed',
  category: 'urgent_operational',
  priority: 'urgent',
  status: 'unread',
  resourceType: 'reply',
  resourceId: 'reply-1',
  eventId: 'event-1',
  title: 'Reply publication failed',
  body: null,
  readAt: null,
  createdAt: NOW,
  updatedAt: NOW,
}
const job = {
  data: {
    notificationEmailId: EMAIL_ID,
    organizationId: ORG,
    propertyId: PROPERTY,
    capability: 'notification.send_email',
    policyVersionAtEnqueue: 'test',
    initiator: { kind: 'system', id: 'test' },
  } satisfies UrgentEmailJobData,
}

function fakeDeps() {
  const send = vi.fn(
    async (): Promise<NotificationDeliveryOutcome> => ({
      kind: 'accepted',
      providerMessageId: 'provider-1',
      acceptedAt: NOW,
    }),
  )
  return {
    emailRepo: {
      findById: vi.fn(async () => entry),
      markAccepted: vi.fn(async () => {}),
      markDelayed: vi.fn(async () => {}),
      markFailed: vi.fn(async () => {}),
      markSuppressed: vi.fn(async () => {}),
    },
    preferenceRepo: { findForDelivery: vi.fn(async () => null) },
    notifRepo: { findByIdForProperty: vi.fn(async () => notification) },
    userLookup: { getEmail: vi.fn(async () => 'manager@example.com') },
    emailSender: { send },
    resolvePropertyScope: vi.fn(async () => ({
      organizationId: ORG,
      propertyId: PROPERTY,
      timezone: 'America/New_York',
    })),
    authorizeScope: vi.fn(async () => true),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn(),
    },
    clock: () => NOW,
  }
}

describe('immediate notification email job', () => {
  let deps: ReturnType<typeof fakeDeps>

  beforeEach(() => {
    deps = fakeDeps()
  })

  const run = () =>
    createUrgentEmailJobHandler(
      deps as unknown as Parameters<typeof createUrgentEmailJobHandler>[0],
    )(job)

  it('resolves and authorizes the concrete property before any notification read or effect', async () => {
    deps.authorizeScope.mockResolvedValue(false)
    await run()
    expect(deps.resolvePropertyScope).toHaveBeenCalledWith(ORG, PROPERTY)
    expect(deps.emailRepo.findById).not.toHaveBeenCalled()
    expect(deps.emailSender.send).not.toHaveBeenCalled()
  })

  it('suppresses delivery when the current property preference is disabled', async () => {
    deps.preferenceRepo.findForDelivery.mockResolvedValue({ enabled: false } as never)
    await run()
    expect(deps.emailRepo.markSuppressed).toHaveBeenCalledWith(
      EMAIL_ID,
      ORG,
      PROPERTY,
      'preference_disabled',
      NOW,
    )
    expect(deps.emailSender.send).not.toHaveBeenCalled()
  })

  it('records provider acceptance and message id only after acceptance', async () => {
    await run()
    expect(deps.emailRepo.markAccepted).toHaveBeenCalledWith(
      EMAIL_ID,
      ORG,
      PROPERTY,
      'provider-1',
      NOW,
    )
  })

  it('classifies transient rejection for retry and never marks accepted', async () => {
    deps.emailSender.send.mockResolvedValue({
      kind: 'rejected',
      classification: 'transient',
      providerCode: 'rate_limit_exceeded',
    })
    await expect(run()).rejects.toThrow('Transient email provider rejection')
    expect(deps.emailRepo.markFailed).toHaveBeenCalledWith(
      EMAIL_ID,
      ORG,
      PROPERTY,
      'transient',
      new Date('2026-01-15T15:00:30.000Z'),
      NOW,
    )
    expect(deps.emailRepo.markAccepted).not.toHaveBeenCalled()
  })

  it('persists provider suppression without retrying', async () => {
    deps.emailSender.send.mockResolvedValue({
      kind: 'rejected',
      classification: 'suppressed',
      providerCode: 'recipient_suppressed',
    })
    await run()
    expect(deps.emailRepo.markFailed).toHaveBeenCalledWith(
      EMAIL_ID,
      ORG,
      PROPERTY,
      'suppressed',
      null,
      NOW,
    )
    expect(deps.emailRepo.markAccepted).not.toHaveBeenCalled()
  })
})
