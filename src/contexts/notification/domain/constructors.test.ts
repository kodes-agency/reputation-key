// Notification context — domain constructor tests

import { describe, it, expect } from 'vitest'
import { createNotification } from './constructors'
import { createNotificationEmail } from './constructors-email'
import { createNotificationPreference } from './constructors-preference'
import { markNotificationRead, dismissNotification } from './constructors-transitions'
import {
  organizationId,
  userId,
  notificationId,
  notificationEmailId,
  notificationPreferenceId,
} from '#/shared/domain/ids'
import type { Notification as DomainNotification, NotificationType } from './types'
import type { Result } from '#/shared/domain'
import type { NotificationError } from './errors'

const ORG_ID = organizationId('org-1')
const USER_ID = userId('user-1')
const NOTIFICATION_ID = notificationId('notif-1')
const EMAIL_ID = notificationEmailId('email-1')
const PREFERENCE_ID = notificationPreferenceId('pref-1')
const FIXED_DATE = new Date('2026-06-10T10:00:00Z')
const clock = () => FIXED_DATE

describe('createNotification', () => {
  const validInput = {
    id: NOTIFICATION_ID,
    userId: USER_ID,
    organizationId: ORG_ID,
    type: 'review.created' as NotificationType,
    resourceType: 'inbox_item' as 'inbox_item' | 'reply' | 'goal',
    resourceId: 'res-1',
    eventId: 'evt-1',
    title: 'New review',
    body: 'A 4-star review was received',
  }

  /** Assert every type in `types` produces a notification with `expectedPriority`. */
  function expectPriorityFor(
    types: ReadonlyArray<NotificationType>,
    expectedPriority: 'urgent' | 'normal',
  ): void {
    for (const type of types) {
      const result = createNotification({ ...validInput, type }, clock)
      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value.priority).toBe(expectedPriority)
      }
    }
  }

  it('returns ok with a notification for valid input', () => {
    const result = createNotification(validInput, clock)

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      const n = result.value
      expect(n.id).toBe(NOTIFICATION_ID)
      expect(n.userId).toBe(USER_ID)
      expect(n.organizationId).toBe(ORG_ID)
      expect(n.type).toBe('review.created')
      expect(n.priority).toBe('normal')
      expect(n.status).toBe('unread')
      expect(n.resourceType).toBe('inbox_item')
      expect(n.resourceId).toBe('res-1')
      expect(n.eventId).toBe('evt-1')
      expect(n.title).toBe('New review')
      expect(n.body).toBe('A 4-star review was received')
      expect(n.readAt).toBeNull()
      expect(n.createdAt).toBe(FIXED_DATE)
      expect(n.updatedAt).toBe(FIXED_DATE)
    }
  })

  it('returns err for an invalid notification type', () => {
    const result = createNotification(
      { ...validInput, type: 'invalid.type' as NotificationType },
      clock,
    )
    expectConstructorError(result, 'invalid_type', { type: 'invalid.type' })
  })

  it('returns err for an invalid resource type', () => {
    const result = createNotification(
      { ...validInput, resourceType: 'invalid' as 'inbox_item' | 'reply' | 'goal' },
      clock,
    )
    expectConstructorError(result, 'invalid_resource_type', { resourceType: 'invalid' })
  })

  it('sets priority to "urgent" for urgent types', () => {
    const urgentTypes = [
      'reply.pending_approval',
      'reply.publish_failed',
      'inbox.escalated',
    ] as const

    expectPriorityFor(urgentTypes, 'urgent')
  })

  it('sets priority to "normal" for non-urgent types', () => {
    const normalTypes: Array<typeof validInput.type> = [
      'review.created',
      'feedback.created',
      'reply.approved',
      'reply.rejected',
      'reply.published',
      'inbox.assigned',
      'inbox_note.added',
      'goal.completed',
    ]

    expectPriorityFor(normalTypes, 'normal')
  })

  it('accepts null body', () => {
    const result = createNotification({ ...validInput, body: null }, clock)
    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.body).toBeNull()
    }
  })

  it('uses the clock for createdAt and updatedAt', () => {
    const customDate = new Date('2025-01-01T00:00:00Z')
    const result = createNotification(validInput, () => customDate)
    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.createdAt).toBe(customDate)
      expect(result.value.updatedAt).toBe(customDate)
    }
  })
})

// ── createNotificationEmail ─────────────────────────────────────────

describe('createNotificationEmail', () => {
  const NOTIF_ID = notificationId('notif-1')

  it('returns ok with a valid email queue entry', () => {
    const result = createNotificationEmail(
      {
        id: EMAIL_ID,
        notificationId: NOTIF_ID,
        userId: USER_ID,
        organizationId: ORG_ID,
        priority: 'urgent',
      },
      clock,
    )

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      const e = result.value
      expect(e.id).toBe(EMAIL_ID)
      expect(e.notificationId).toBe(NOTIF_ID)
      expect(e.userId).toBe(USER_ID)
      expect(e.organizationId).toBe(ORG_ID)
      expect(e.status).toBe('pending')
      expect(e.priority).toBe('urgent')
      expect(e.sentAt).toBeNull()
      expect(e.failedAt).toBeNull()
      expect(e.retryCount).toBe(0)
      expect(e.createdAt).toBe(FIXED_DATE)
      expect(e.updatedAt).toBe(FIXED_DATE)
    }
  })

  it('uses the provided clock', () => {
    const customDate = new Date('2025-06-15T08:30:00Z')
    const result = createNotificationEmail(
      {
        id: EMAIL_ID,
        notificationId: NOTIF_ID,
        userId: USER_ID,
        organizationId: ORG_ID,
        priority: 'normal',
      },
      () => customDate,
    )

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.id).toBe(EMAIL_ID)
      expect(result.value.createdAt).toBe(customDate)
    }
  })
})

// ── createNotificationPreference ────────────────────────────────────

describe('createNotificationPreference', () => {
  it('returns ok with a valid preference', () => {
    const result = createNotificationPreference(
      {
        id: PREFERENCE_ID,
        userId: USER_ID,
        organizationId: ORG_ID,
        type: 'review.created',
        emailEnabled: true,
        inAppEnabled: false,
      },
      clock,
    )

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      const p = result.value
      expect(p.id).toBe(PREFERENCE_ID)
      expect(p.userId).toBe(USER_ID)
      expect(p.organizationId).toBe(ORG_ID)
      expect(p.type).toBe('review.created')
      expect(p.emailEnabled).toBe(true)
      expect(p.inAppEnabled).toBe(false)
      expect(p.createdAt).toBe(FIXED_DATE)
      expect(p.updatedAt).toBe(FIXED_DATE)
    }
  })

  it('returns err for an invalid type', () => {
    const result = createNotificationPreference(
      {
        id: PREFERENCE_ID,
        userId: USER_ID,
        organizationId: ORG_ID,
        type: 'bogus.type' as unknown as NotificationType,
        emailEnabled: true,
        inAppEnabled: true,
      },
      clock,
    )

    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('invalid_type')
    }
  })
})

/** Assert a transition result is an `invalid_status` error. */
function expectInvalidStatus(
  result: Result<DomainNotification, NotificationError>,
): void {
  expect(result.isErr()).toBe(true)
  if (result.isErr()) {
    expect(result.error.code).toBe('invalid_status')
  }
}

/** Assert a constructor result is a `NotificationError` with the given code + details. */
function expectConstructorError(
  result: Result<DomainNotification, NotificationError>,
  code: string,
  details: Record<string, unknown>,
): void {
  expect(result.isErr()).toBe(true)
  if (result.isErr()) {
    expect(result.error._tag).toBe('NotificationError')
    expect(result.error.code).toBe(code)
    expect(result.error.details).toEqual(details)
  }
}
// ── markNotificationRead ────────────────────────────────────────────

describe('markNotificationRead', () => {
  const baseNotification: DomainNotification = {
    id: notificationId('n-1'),
    userId: USER_ID,
    organizationId: ORG_ID,
    type: 'review.created',
    priority: 'normal',
    status: 'unread',
    resourceType: 'inbox_item',
    resourceId: 'res-1',
    eventId: 'evt-1',
    title: 'Test',
    body: null,
    readAt: null,
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
  }

  it('marks an unread notification as read', () => {
    const result = markNotificationRead(baseNotification, clock)

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.status).toBe('read')
      expect(result.value.readAt).toBe(FIXED_DATE)
      expect(result.value.updatedAt).toBe(FIXED_DATE)
    }
  })

  it('is idempotent when already read', () => {
    const readNotification: DomainNotification = {
      ...baseNotification,
      status: 'read',
      readAt: FIXED_DATE,
    }

    const result = markNotificationRead(readNotification, clock)
    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value).toEqual(readNotification) // unchanged
    }
  })

  it('rejects dismissed notification — only unread → read is valid', () => {
    const dismissed: DomainNotification = {
      ...baseNotification,
      status: 'dismissed',
    }

    const result = markNotificationRead(dismissed, clock)
    expectInvalidStatus(result)
  })
})

// ── dismissNotification ────────────────────────────────────────────

describe('dismissNotification', () => {
  const baseNotification: DomainNotification = {
    id: notificationId('n-1'),
    userId: USER_ID,
    organizationId: ORG_ID,
    type: 'review.created',
    priority: 'normal',
    status: 'unread',
    resourceType: 'inbox_item',
    resourceId: 'res-1',
    eventId: 'evt-1',
    title: 'Test',
    body: null,
    readAt: null,
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
  }

  it('dismisses an unread notification', () => {
    const result = dismissNotification(baseNotification, clock)

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.status).toBe('dismissed')
      expect(result.value.updatedAt).toBe(FIXED_DATE)
    }
  })

  it('dismisses a read notification', () => {
    const readNotification: DomainNotification = {
      ...baseNotification,
      status: 'read',
      readAt: FIXED_DATE,
    }

    const result = dismissNotification(readNotification, clock)
    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.status).toBe('dismissed')
    }
  })

  it('is idempotent when already dismissed', () => {
    const dismissed: DomainNotification = {
      ...baseNotification,
      status: 'dismissed',
    }

    const result = dismissNotification(dismissed, clock)
    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value).toEqual(dismissed) // unchanged
    }
  })

  it('rejects notification in an unexpected status', () => {
    // NotificationStatus only has unread/read/dismissed, all handled above.
    // This guards against future status additions.
    const bogus: DomainNotification = {
      ...baseNotification,
      status: 'unknown' as DomainNotification['status'],
    }

    const result = dismissNotification(bogus, clock)
    expectInvalidStatus(result)
  })
})
