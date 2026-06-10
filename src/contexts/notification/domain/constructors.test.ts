// Notification context — domain constructor tests

import { describe, it, expect } from 'vitest'
import { createNotification } from './constructors'
import { createNotificationEmail } from './constructors-email'
import { createNotificationPreference } from './constructors-preference'
import {
  markNotificationRead,
  markEmailSent,
  markEmailFailed,
  markEmailSkipped,
} from './constructors-transitions'
import {
  organizationId,
  userId,
  notificationId,
  notificationEmailId,
} from '#/shared/domain/ids'
import type { Notification, NotificationEmail, NotificationType } from './types'

const ORG_ID = organizationId('org-1')
const USER_ID = userId('user-1')
const FIXED_DATE = new Date('2026-06-10T10:00:00Z')
const clock = () => FIXED_DATE

// ── createNotification ──────────────────────────────────────────────

describe('createNotification', () => {
  const validInput = {
    userId: USER_ID,
    organizationId: ORG_ID,
    type: 'review.created' as NotificationType,
    resourceType: 'inbox_item' as 'inbox_item' | 'reply' | 'goal',
    resourceId: 'res-1',
    eventId: 'evt-1',
    title: 'New review',
    body: 'A 4-star review was received',
  }

  it('returns ok with a notification for valid input', () => {
    const result = createNotification(validInput, clock)

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      const n = result.value
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

    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error._tag).toBe('NotificationError')
      expect(result.error.code).toBe('invalid_type')
      expect(result.error.details).toEqual({ type: 'invalid.type' })
    }
  })

  it('returns err for an invalid resource type', () => {
    const result = createNotification(
      { ...validInput, resourceType: 'invalid' as 'inbox_item' | 'reply' | 'goal' },
      clock,
    )

    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error._tag).toBe('NotificationError')
      expect(result.error.code).toBe('invalid_resource_type')
      expect(result.error.details).toEqual({ resourceType: 'invalid' })
    }
  })

  it('sets priority to "urgent" for urgent types', () => {
    const urgentTypes = [
      'reply.pending_approval',
      'reply.publish_failed',
      'inbox.escalated',
    ] as const

    for (const type of urgentTypes) {
      const result = createNotification({ ...validInput, type }, clock)
      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value.priority).toBe('urgent')
      }
    }
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

    for (const type of normalTypes) {
      const result = createNotification({ ...validInput, type }, clock)
      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value.priority).toBe('normal')
      }
    }
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
        notificationId: NOTIF_ID,
        userId: USER_ID,
        organizationId: ORG_ID,
        priority: 'normal',
      },
      () => customDate,
    )

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.createdAt).toBe(customDate)
    }
  })
})

// ── createNotificationPreference ────────────────────────────────────

describe('createNotificationPreference', () => {
  it('returns ok with a valid preference', () => {
    const result = createNotificationPreference(
      {
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

// ── markNotificationRead ────────────────────────────────────────────

describe('markNotificationRead', () => {
  const baseNotification: Notification = {
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
    const readNotification: Notification = {
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
    const dismissed: Notification = {
      ...baseNotification,
      status: 'dismissed',
    }

    const result = markNotificationRead(dismissed, clock)
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('invalid_status')
    }
  })
})

// ── markEmailSent ───────────────────────────────────────────────────

describe('markEmailSent', () => {
  const baseEmail: NotificationEmail = {
    id: notificationEmailId('e-1'),
    notificationId: notificationId('n-1'),
    userId: USER_ID,
    organizationId: ORG_ID,
    status: 'pending',
    priority: 'urgent',
    sentAt: null,
    failedAt: null,
    retryCount: 0,
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
  }

  it('marks a pending email as sent', () => {
    const result = markEmailSent(baseEmail, clock)

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.status).toBe('sent')
      expect(result.value.sentAt).toBe(FIXED_DATE)
      expect(result.value.updatedAt).toBe(FIXED_DATE)
    }
  })

  it('is idempotent when already sent', () => {
    const sent: NotificationEmail = {
      ...baseEmail,
      status: 'sent',
      sentAt: FIXED_DATE,
    }

    const result = markEmailSent(sent, clock)
    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value).toEqual(sent)
    }
  })

  it('marks a failed email as sent (retry path)', () => {
    const failed: NotificationEmail = {
      ...baseEmail,
      status: 'failed',
      failedAt: FIXED_DATE,
      retryCount: 2,
    }

    const result = markEmailSent(failed, clock)
    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.status).toBe('sent')
      expect(result.value.sentAt).toBe(FIXED_DATE)
      expect(result.value.retryCount).toBe(2) // preserved
    }
  })
})

// ── markEmailFailed ─────────────────────────────────────────────────

describe('markEmailFailed', () => {
  it('increments retryCount and sets failed status', () => {
    const base: NotificationEmail = {
      id: notificationEmailId('e-1'),
      notificationId: notificationId('n-1'),
      userId: USER_ID,
      organizationId: ORG_ID,
      status: 'pending',
      priority: 'normal',
      sentAt: null,
      failedAt: null,
      retryCount: 2,
      createdAt: FIXED_DATE,
      updatedAt: FIXED_DATE,
    }

    const result = markEmailFailed(base, clock)

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.status).toBe('failed')
      expect(result.value.failedAt).toBe(FIXED_DATE)
      expect(result.value.retryCount).toBe(3)
      expect(result.value.updatedAt).toBe(FIXED_DATE)
    }
  })
})

// ── markEmailSkipped ────────────────────────────────────────────────

describe('markEmailSkipped', () => {
  it('sets status to skipped', () => {
    const base: NotificationEmail = {
      id: notificationEmailId('e-1'),
      notificationId: notificationId('n-1'),
      userId: USER_ID,
      organizationId: ORG_ID,
      status: 'pending',
      priority: 'normal',
      sentAt: null,
      failedAt: null,
      retryCount: 0,
      createdAt: FIXED_DATE,
      updatedAt: FIXED_DATE,
    }

    const result = markEmailSkipped(base, clock)

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.status).toBe('skipped')
      expect(result.value.updatedAt).toBe(FIXED_DATE)
      // Does not alter other fields
      expect(result.value.sentAt).toBeNull()
      expect(result.value.failedAt).toBeNull()
      expect(result.value.retryCount).toBe(0)
    }
  })
})
