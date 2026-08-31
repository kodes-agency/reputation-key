// Shared test fixtures for the notification delivery jobs.
//
// The previous version of this file described a repository that no longer
// exists (`findPendingByOrg`, `markSent`, `markSkipped`) and was imported by
// nothing, so it could not have caught a port drift. These builders track the
// real ports, so a port change breaks compilation here once instead of in every
// test.

import { vi } from 'vitest'
import type { Mock } from 'vitest'
import type { LoggerPort } from '#/shared/domain/logger.port'
import {
  notificationEmailId,
  notificationId,
  organizationId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import type {
  Notification,
  NotificationCadence,
  NotificationCategory,
  NotificationEmail,
  NotificationPriority,
  NotificationResourceType,
  NotificationType,
} from '../../domain/types'
import type { NotificationPayload } from '../../domain/notification-payload'
import type { DigestItem } from './digest-assembly'

const NOW = new Date('2026-08-21T08:00:00.000Z')
const ORG = 'org-1'
const USER = 'user-1'

export type EmailOverrides = Partial<{
  id: string
  notificationId: string
  userId: string
  organizationId: string
  propertyId: string | null
  category: NotificationCategory
  cadence: NotificationCadence
  status: NotificationEmail['status']
  priority: NotificationPriority
  idempotencyKey: string
  retryCount: number
}>

export function buildNotificationEmail(
  overrides: EmailOverrides = {},
): NotificationEmail {
  const rawNotificationId = overrides.notificationId ?? 'notification-1'
  return {
    id: notificationEmailId(overrides.id ?? 'email-1'),
    notificationId: notificationId(rawNotificationId),
    userId: userId(overrides.userId ?? USER),
    organizationId: organizationId(overrides.organizationId ?? ORG),
    propertyId:
      overrides.propertyId === null ? null : propertyId(overrides.propertyId ?? 'prop-a'),
    category: overrides.category ?? 'urgent_operational',
    cadence: overrides.cadence ?? 'daily',
    status: overrides.status ?? 'pending',
    priority: overrides.priority ?? 'normal',
    idempotencyKey: overrides.idempotencyKey ?? `${rawNotificationId}:email`,
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
    retryCount: overrides.retryCount ?? 0,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

export type NotificationOverrides = Partial<{
  id: string
  userId: string
  organizationId: string
  propertyId: string | null
  type: NotificationType
  category: NotificationCategory
  priority: NotificationPriority
  resourceType: NotificationResourceType
  resourceId: string
  payload: NotificationPayload
  title: string
  body: string | null
}>

export function buildNotification(overrides: NotificationOverrides = {}): Notification {
  return {
    id: notificationId(overrides.id ?? 'notification-1'),
    userId: userId(overrides.userId ?? USER),
    organizationId: organizationId(overrides.organizationId ?? ORG),
    propertyId:
      overrides.propertyId === null ? null : propertyId(overrides.propertyId ?? 'prop-a'),
    type: overrides.type ?? 'review.created',
    category: overrides.category ?? 'urgent_operational',
    priority: overrides.priority ?? 'normal',
    status: 'unread',
    resourceType: overrides.resourceType ?? 'inbox_item',
    resourceId: overrides.resourceId ?? 'inbox-1',
    eventId: 'event-1',
    // Deliberately a raw id: pre-template rows really do look like this, and
    // the whole point of the render layer is that this string never ships.
    title: overrides.title ?? 'Inbox item 61ed98fc-1c2b-4d6e-9f00-000000000001',
    body: overrides.body ?? null,
    payload: overrides.payload ?? {},
    coalescedCount: 1,
    coalescedLatestAt: null,
    readAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

/** A queue row paired with its notification, both sharing the same ids. */
export function buildDigestItem(
  overrides: EmailOverrides & NotificationOverrides = {},
): DigestItem {
  const rawNotificationId = `notification-${overrides.resourceId ?? overrides.id ?? 'x'}`
  return {
    entry: buildNotificationEmail({
      ...overrides,
      id: overrides.id ?? `email-${rawNotificationId}`,
      notificationId: rawNotificationId,
      cadence: 'daily',
    }),
    notification: buildNotification({
      ...overrides,
      id: rawNotificationId,
      propertyId: overrides.propertyId ?? 'prop-a',
    }),
  }
}

export type FakeJobLogger = LoggerPort & {
  info: Mock
  warn: Mock
  error: Mock
  debug: Mock
}

export const createFakeJobLogger = (): FakeJobLogger => {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  }
  logger.child.mockReturnValue(logger)
  return logger as unknown as FakeJobLogger
}
