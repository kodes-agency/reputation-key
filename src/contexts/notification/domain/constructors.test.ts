import { describe, expect, it } from 'vitest'
import { createNotification } from './constructors'
import { createNotificationEmail } from './constructors-email'
import { createNotificationPreference } from './constructors-preference'
import { dismissNotification, markNotificationRead } from './constructors-transitions'
import {
  notificationEmailId,
  notificationId,
  notificationPreferenceId,
  organizationId,
  propertyId,
  userId,
} from '#/shared/domain/ids'

const NOW = new Date('2026-01-15T10:00:00.000Z')
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
      { ...base, payload: { propertyName: 'Riverside Hotel', rating: 2 } },
      () => NOW,
    )

    if (result.isErr()) throw result.error
    expect(result.value).toMatchObject({
      title: 'Reply failed to publish at Riverside Hotel',
      payload: { propertyName: 'Riverside Hotel', rating: 2 },
      coalescedCount: 1,
      coalescedLatestAt: null,
    })
    expect(result.value.body).toContain('Google rejected the reply to a 2-star review')
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

  it('rejects disabling mandatory notifications', () => {
    const result = createNotificationPreference(
      {
        id: notificationPreferenceId('preference-1'),
        userId: USER,
        organizationId: ORG,
        propertyId: PROPERTY,
        category: 'mandatory',
        channel: 'email',
        enabled: false,
        cadence: 'immediate',
        urgentBypassEnabled: false,
        quietHoursStart: null,
        quietHoursEnd: null,
      },
      () => NOW,
    )
    expect(result.isErr()).toBe(true)
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
})
