import { describe, expect, it } from 'vitest'
import { createNotification } from './constructors'
import { createNotificationEmail } from './constructors-email'
import { createNotificationPreference } from './constructors-preference'
import {
  dismissNotification,
  markNotificationRead,
  markNotificationUnread,
} from './constructors-transitions'
import {
  notificationEmailId,
  notificationId,
  notificationPreferenceId,
  organizationId,
  propertyId,
  userId,
} from '#/shared/domain/ids'

const NOW = new Date('2026-01-15T10:00:00.000Z')
const LATER = new Date('2026-01-15T10:01:00.000Z')
const ORG = organizationId('org-1')
const PROPERTY = propertyId('11111111-1111-4111-8111-111111111111')
const USER = userId('user-1')
const base = {
  id: notificationId('notification-1'),
  userId: USER,
  organizationId: ORG,
  propertyId: PROPERTY,
  type: 'reply.publish_failed' as const,
  resourceType: 'reply' as const,
  resourceId: 'reply-1',
  eventId: 'event-1',
}

const createValidNotification = () => {
  const result = createNotification(base, () => NOW)
  if (result.isErr()) throw result.error
  return result.value
}

const preferenceBase = {
  id: notificationPreferenceId('preference-validation'),
  userId: USER,
  organizationId: ORG,
  propertyId: PROPERTY,
  category: 'urgent_operational' as const,
  channel: 'email' as const,
  enabled: true,
  cadence: 'immediate' as const,
  urgentBypassEnabled: false,
  quietHoursStart: null,
  quietHoursEnd: null,
}

describe('notification constructors', () => {
  it('creates a property-scoped notification and governed category', () => {
    const result = createNotification(base, () => NOW)

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value).toMatchObject({
        propertyId: PROPERTY,
        category: 'urgent_operational',
        priority: 'urgent',
      })
    }
  })

  it('renders title and body from the type and payload, not from the caller', () => {
    const result = createNotification(
      { ...base, payload: { propertyName: 'Riverside Hotel' } },
      () => NOW,
    )

    if (result.isErr()) throw result.error
    expect(result.value).toMatchObject({
      title: 'Reply failed to publish at Riverside Hotel',
      payload: { propertyName: 'Riverside Hotel' },
      coalescedCount: 1,
      coalescedLatestAt: null,
    })
    expect(result.value.body).toContain('Google rejected the reply to a review')
  })

  it('renders a usable title with no payload at all', () => {
    // The old constructor rejected an empty title; a title is now impossible to
    // omit, so the guard is gone and this is what replaced it: every template
    // must read correctly from `{}`.
    const result = createNotification(base, () => NOW)

    if (result.isErr()) throw result.error
    expect(result.value.title).toBe('Reply failed to publish')
    expect(result.value.payload).toEqual({})
  })

  it('strips payload keys outside the ADR 0046 r.8 allowlist', () => {
    const result = createNotification(
      {
        ...base,
        payload: {
          propertyName: 'Riverside Hotel',
          reviewText: 'Filthy room',
          reviewerName: 'Jane G.',
          sentiment: -0.9,
        },
      },
      () => NOW,
    )

    if (result.isErr()) throw result.error
    expect(result.value.payload).toEqual({ propertyName: 'Riverside Hotel' })
  })

  it('rejects an empty resourceId — the deep link and coalescing key need it', () => {
    const result = createNotification({ ...base, resourceId: '  ' }, () => NOW)

    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('invalid_resource_id')
  })

  it('rejects a notification without a property scope', () => {
    const result = createNotification(
      { ...base, propertyId: '' as typeof PROPERTY },
      () => NOW,
    )
    expect(result.isErr()).toBe(true)
  })

  it('creates mandatory account notifications at Organization scope', () => {
    const result = createNotification(
      {
        ...base,
        propertyId: null,
        type: 'account.organization_access_removed',
        resourceType: 'organization',
        resourceId: ORG,
      },
      () => NOW,
    )

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value).toMatchObject({
        propertyId: null,
        category: 'mandatory',
        priority: 'normal',
      })
    }
  })

  it('rejects a property scope for mandatory account notifications', () => {
    const result = createNotification(
      {
        ...base,
        type: 'account.organization_access_granted',
        resourceType: 'organization',
        resourceId: ORG,
      },
      () => NOW,
    )

    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error).toMatchObject({
        code: 'invalid_input',
        message: 'Mandatory notifications must use Organization scope',
      })
    }
  })

  it('rejects a notification without a recipient', () => {
    const result = createNotification({ ...base, userId: '' as typeof USER }, () => NOW)

    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error).toMatchObject({
        code: 'invalid_input',
        message: 'userId is required',
      })
    }
  })

  it('rejects unknown notification and resource types before rendering', () => {
    const unknownType = createNotification(
      { ...base, type: 'review.deleted' as typeof base.type },
      () => NOW,
    )
    const unknownResource = createNotification(
      { ...base, resourceType: 'review' as typeof base.resourceType },
      () => NOW,
    )

    expect(unknownType.isErr()).toBe(true)
    if (unknownType.isErr()) {
      expect(unknownType.error).toMatchObject({
        code: 'invalid_type',
        context: { type: 'review.deleted' },
      })
    }
    expect(unknownResource.isErr()).toBe(true)
    if (unknownResource.isErr()) {
      expect(unknownResource.error).toMatchObject({
        code: 'invalid_resource_type',
        context: { resourceType: 'review' },
      })
    }
  })

  it('rejects an empty event identity used by delivery idempotency', () => {
    const result = createNotification({ ...base, eventId: '\t' }, () => NOW)

    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error).toMatchObject({
        code: 'invalid_event_id',
        message: 'EventId must not be empty',
      })
    }
  })

  it('creates non-urgent notifications with normal priority and complete timestamps', () => {
    const result = createNotification(
      {
        ...base,
        type: 'review.created',
        resourceType: 'inbox_item',
      },
      () => NOW,
    )

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value).toMatchObject({
        category: 'workflow_collaboration',
        priority: 'normal',
        status: 'unread',
        readAt: null,
        createdAt: NOW,
        updatedAt: NOW,
      })
    }
  })

  it('creates a durable email entry without claiming provider acceptance', () => {
    const result = createNotificationEmail(
      {
        id: notificationEmailId('email-1'),
        notificationId: base.id,
        userId: USER,
        organizationId: ORG,
        propertyId: PROPERTY,
        category: 'urgent_operational',
        cadence: 'immediate',
        priority: 'urgent',
        idempotencyKey: 'notification-1:email',
        notBefore: null,
      },
      () => NOW,
    )

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value).toMatchObject({
        status: 'pending',
        providerMessageId: null,
        acceptedAt: null,
      })
    }
  })

  it('creates an Organization-scoped mandatory email entry', () => {
    const result = createNotificationEmail(
      {
        id: notificationEmailId('email-org-1'),
        notificationId: base.id,
        userId: USER,
        organizationId: ORG,
        propertyId: null,
        category: 'mandatory',
        cadence: 'immediate',
        priority: 'normal',
        idempotencyKey: 'notification-org-1:email',
        notBefore: null,
      },
      () => NOW,
    )

    expect(result.isOk()).toBe(true)
    if (result.isOk()) expect(result.value.propertyId).toBeNull()
  })

  it('rejects scope/category mismatches in the durable email queue', () => {
    const result = createNotificationEmail(
      {
        id: notificationEmailId('email-org-mismatch'),
        notificationId: base.id,
        userId: USER,
        organizationId: ORG,
        propertyId: PROPERTY,
        category: 'mandatory',
        cadence: 'immediate',
        priority: 'normal',
        idempotencyKey: 'notification-org-mismatch:email',
        notBefore: null,
      },
      () => NOW,
    )

    expect(result.isErr()).toBe(true)
  })

  it('validates category/channel/cadence and quiet hours preferences', () => {
    const result = createNotificationPreference(
      {
        id: notificationPreferenceId('preference-1'),
        userId: USER,
        organizationId: ORG,
        propertyId: PROPERTY,
        category: 'urgent_operational',
        channel: 'email',
        enabled: true,
        cadence: 'immediate',
        urgentBypassEnabled: true,
        quietHoursStart: '22:00',
        quietHoursEnd: '07:00',
      },
      () => NOW,
    )
    expect(result.isOk()).toBe(true)
  })

  it('rejects every preference row for Organization-wide mandatory notices', () => {
    const result = createNotificationPreference(
      {
        id: notificationPreferenceId('preference-1'),
        userId: USER,
        organizationId: ORG,
        propertyId: PROPERTY,
        category: 'mandatory',
        channel: 'email',
        enabled: true,
        cadence: 'daily',
        urgentBypassEnabled: false,
        quietHoursStart: null,
        quietHoursEnd: null,
      },
      () => NOW,
    )
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error).toMatchObject({
        code: 'invalid_input',
        message: 'Mandatory notifications cannot be configured',
      })
    }
  })

  it('keeps Action Required in-app while allowing its email to be disabled', () => {
    const requiredInApp = createNotificationPreference(
      {
        id: notificationPreferenceId('preference-action-in-app'),
        userId: USER,
        organizationId: ORG,
        propertyId: PROPERTY,
        category: 'urgent_operational',
        channel: 'in_app',
        enabled: false,
        cadence: 'immediate',
        urgentBypassEnabled: false,
        quietHoursStart: null,
        quietHoursEnd: null,
      },
      () => NOW,
    )
    const configurableEmail = createNotificationPreference(
      {
        id: notificationPreferenceId('preference-action-email'),
        userId: USER,
        organizationId: ORG,
        propertyId: PROPERTY,
        category: 'urgent_operational',
        channel: 'email',
        enabled: false,
        cadence: 'daily',
        urgentBypassEnabled: false,
        quietHoursStart: '22:00',
        quietHoursEnd: '07:00',
      },
      () => NOW,
    )

    expect(requiredInApp.isErr()).toBe(true)
    expect(configurableEmail.isOk()).toBe(true)
  })

  it.each([
    {
      caseName: 'unknown category',
      input: { category: 'digest_summary' as typeof preferenceBase.category },
      message: 'Invalid notification category',
      code: 'invalid_type',
    },
    {
      caseName: 'unknown channel',
      input: { channel: 'sms' as typeof preferenceBase.channel },
      message: 'Invalid notification channel',
      code: 'invalid_input',
    },
    {
      caseName: 'unknown cadence',
      input: { cadence: 'weekly' as typeof preferenceBase.cadence },
      message: 'Invalid notification cadence',
      code: 'invalid_input',
    },
    {
      caseName: 'missing quiet-hours end',
      input: { quietHoursStart: '22:00' },
      message: 'Quiet hours require a valid start and end',
      code: 'invalid_input',
    },
    {
      caseName: 'invalid quiet-hours start',
      input: { quietHoursStart: '24:00', quietHoursEnd: '07:00' },
      message: 'Quiet hours require a valid start and end',
      code: 'invalid_input',
    },
    {
      caseName: 'invalid quiet-hours end',
      input: { quietHoursStart: '22:00', quietHoursEnd: '7:00' },
      message: 'Quiet hours require a valid start and end',
      code: 'invalid_input',
    },
    {
      caseName: 'in-app urgent bypass',
      input: { channel: 'in_app' as const, urgentBypassEnabled: true },
      message: 'Urgent bypass applies only to email',
      code: 'invalid_input',
    },
  ])('rejects $caseName preferences', ({ input, message, code }) => {
    const result = createNotificationPreference(
      { ...preferenceBase, ...input },
      () => NOW,
    )

    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error).toMatchObject({ code, message })
  })

  it('does not create an enabled in-app preference for a mandatory notice', () => {
    const result = createNotificationPreference(
      {
        ...preferenceBase,
        category: 'mandatory',
        channel: 'in_app',
      },
      () => NOW,
    )

    expect(result.isErr()).toBe(true)
  })

  it('marks an unread notification read without changing tenant scope', () => {
    const notification = createNotification(base, () => NOW)
    if (notification.isErr()) throw notification.error
    const result = markNotificationRead(
      notification.value,
      () => new Date(NOW.getTime() + 1_000),
    )
    expect(result.isOk()).toBe(true)
    if (result.isOk()) expect(result.value.propertyId).toBe(PROPERTY)
  })

  it('dismisses an unread notification without changing tenant scope', () => {
    const notification = createNotification(base, () => NOW)
    if (notification.isErr()) throw notification.error
    const result = dismissNotification(
      notification.value,
      () => new Date(NOW.getTime() + 1_000),
    )
    expect(result.isOk()).toBe(true)
    if (result.isOk()) expect(result.value.propertyId).toBe(PROPERTY)
  })

  it('keeps a read notification unchanged and does not consult the clock again', () => {
    const notification = createValidNotification()
    const read = markNotificationRead(notification, () => LATER)
    if (read.isErr()) throw read.error
    let clockCalls = 0

    const result = markNotificationRead(read.value, () => {
      clockCalls += 1
      return new Date('2099-01-01T00:00:00.000Z')
    })

    expect(result.isOk()).toBe(true)
    if (result.isOk()) expect(result.value).toBe(read.value)
    expect(clockCalls).toBe(0)
  })

  it('refuses to mark a dismissed notification as read', () => {
    const notification = createValidNotification()
    const dismissed = dismissNotification(notification, () => LATER)
    if (dismissed.isErr()) throw dismissed.error

    const result = markNotificationRead(dismissed.value, () => NOW)

    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error).toMatchObject({
        code: 'invalid_status',
        context: { status: 'dismissed' },
      })
    }
  })

  it('marks a read notification unread and clears its read timestamp', () => {
    const notification = createValidNotification()
    const read = markNotificationRead(notification, () => LATER)
    if (read.isErr()) throw read.error
    const unreadAt = new Date('2026-01-15T10:02:00.000Z')

    const result = markNotificationUnread(read.value, () => unreadAt)

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value).toMatchObject({
        status: 'unread',
        readAt: null,
        updatedAt: unreadAt,
      })
      expect(result.value.createdAt).toBe(NOW)
    }
  })

  it('keeps an unread notification unchanged and does not consult the clock', () => {
    const notification = createValidNotification()
    let clockCalls = 0

    const result = markNotificationUnread(notification, () => {
      clockCalls += 1
      return LATER
    })

    expect(result.isOk()).toBe(true)
    if (result.isOk()) expect(result.value).toBe(notification)
    expect(clockCalls).toBe(0)
  })

  it('does not resurrect a dismissed notification as unread', () => {
    const notification = createValidNotification()
    const dismissed = dismissNotification(notification, () => LATER)
    if (dismissed.isErr()) throw dismissed.error

    const result = markNotificationUnread(dismissed.value, () => NOW)

    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error).toMatchObject({
        code: 'invalid_status',
        message: 'Cannot mark as unread from status: dismissed',
      })
    }
  })

  it('dismisses a read notification while preserving its read timestamp', () => {
    const notification = createValidNotification()
    const read = markNotificationRead(notification, () => LATER)
    if (read.isErr()) throw read.error
    const dismissedAt = new Date('2026-01-15T10:02:00.000Z')

    const result = dismissNotification(read.value, () => dismissedAt)

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value).toMatchObject({
        status: 'dismissed',
        readAt: LATER,
        updatedAt: dismissedAt,
      })
    }
  })

  it('keeps a dismissed notification unchanged and does not consult the clock', () => {
    const notification = createValidNotification()
    const dismissed = dismissNotification(notification, () => LATER)
    if (dismissed.isErr()) throw dismissed.error
    let clockCalls = 0

    const result = dismissNotification(dismissed.value, () => {
      clockCalls += 1
      return NOW
    })

    expect(result.isOk()).toBe(true)
    if (result.isOk()) expect(result.value).toBe(dismissed.value)
    expect(clockCalls).toBe(0)
  })

  it('fails closed when a notification carries an unrecognised persisted status', () => {
    const notification = createValidNotification()
    const corrupted = {
      ...notification,
      status: 'archived',
    } as unknown as typeof notification

    const result = dismissNotification(corrupted, () => LATER)

    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error).toMatchObject({
        code: 'invalid_status',
        context: { status: 'archived' },
      })
    }
  })
})
