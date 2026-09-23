// Shared test fixtures for the insert-notification use case + job.
// Eliminates the duplicated fake-deps construction between the use-case tests
// and the job-handler tests. Mirrors the shared `buildTestX(overrides)` convention.

import { vi } from 'vitest'
import type { InsertNotificationDeps } from './insert-notification'
import type {
  Notification,
  NotificationEmail,
  NotificationPreference,
} from '../../domain/notification-types'
import { notificationId, notificationEmailId } from '#/shared/domain/ids'
import {
  NO_QUIET_HOURS,
  resolveCategoryPreference,
} from '../../domain/notification-preference-resolution'

const NOTIF_ID = notificationId('notif-1')
const EMAIL_ID = notificationEmailId('email-1')
const FIXED_DATE = new Date('2026-06-10T10:00:00Z')

export type FakeInsertNotificationDeps = InsertNotificationDeps

/**
 * Build a fully-mocked {@link InsertNotificationDeps} for the insert-notification
 * use-case and job tests. Uses the same literal ids/dates both files asserted on
 * (org-1 / user-1 / notif-1 / email-1 / 2026-06-10T10:00:00Z).
 */
export function buildFakeInsertNotificationDeps(): FakeInsertNotificationDeps {
  return {
    notificationRepo: {
      insert: vi.fn(async (n: Notification) => n),
      findById: vi.fn(async () => null),
      findByIdForProperty: vi.fn(async () => null),
      readFeedHead: vi.fn(async () => ({
        page: { notifications: [], hasMore: false, nextCursor: null },
        unreadCount: 0,
        filterUnreadCount: 0,
        watermark: '2026-06-10T10:00:00.000Z',
      })),
      readFeedPage: vi.fn(async () => ({
        notifications: [],
        hasMore: false,
        nextCursor: null,
      })),
      markRead: vi.fn(async () => {}),
      markAllRead: vi.fn(async () => {}),
      findUnreadByUserTypeResource: vi.fn(async () => null),
      settleUnreadForResource: vi.fn(async () => []),
      refreshUnread: vi.fn(async () => true),
      markUnread: vi.fn(async () => null),
      markAllDismissed: vi.fn(async () => {}),
      findByIds: vi.fn(async () => new Map()),
      findByIdsForProperty: vi.fn(async () => new Map()),
      updateStatus: vi.fn(async () => {}),
    },
    emailRepo: {
      insert: vi.fn(async (e: NotificationEmail) => e),
      findById: vi.fn(async () => null),
      findDueByProperty: vi.fn(async () => []),
      findDueOrganizationScopes: vi.fn(async () => []),
      findDueByOrganization: vi.fn(async () => []),
      markAttemptStarted: vi.fn(async () => {}),
      markAccepted: vi.fn(async () => {}),
      cancelQueuedForNotifications: vi.fn(async () => 0),
      markDelayed: vi.fn(async () => {}),
      markFailed: vi.fn(async () => {}),
      markSuppressed: vi.fn(async () => {}),
      recordProviderState: vi.fn(async () => []),
      findProviderMessageRecipients: vi.fn(async () => []),
      findDueRecipients: vi.fn(async () => []),
      findDueByUser: vi.fn(async () => []),
      suppressRecipient: vi.fn(async () => 0),
      isAddressSuppressed: vi.fn(async () => false),
      suppressAddress: vi.fn(async () => {}),
      forgetAddress: vi.fn(async () => {}),
      recordEmailUnsubscribeScope: vi.fn(async () => {}),
      findOpenDigestBatch: vi.fn(async () => null),
      findDigestBatchEntries: vi.fn(async () => []),
      prepareDigestBatch: vi.fn(async () => {
        throw new Error('prepareDigestBatch is outside this fixture scope')
      }),
      startDigestAttempt: vi.fn(async () => false),
      settleDigestBatch: vi.fn(async () => false),
    },
    preferenceRepo: {
      // No stored row and no personal default: ADR 0046 r.1's versioned
      // defaults, which is what the resolver answers with.
      resolveForDelivery: vi.fn(async (_userId, _orgId, _propertyId, category, channel) =>
        resolveCategoryPreference({
          category,
          channel,
          property: null,
          personalDefault: null,
        }),
      ),
      resolveDeliveryWindow: vi.fn(async () => NO_QUIET_HOURS),
      upsert: vi.fn(async () => ({}) as NotificationPreference),
      applyCategoryDefaultEverywhere: vi.fn(async (categoryDefault) => categoryDefault),
      findByUser: vi.fn(async () => []),
      findCategoryDefaults: vi.fn(async () => []),
      findPropertyDeliveryWindows: vi.fn(async () => []),
      upsertPropertyDeliveryWindow: vi.fn(async (window) => window),
      clearPropertyDeliveryWindow: vi.fn(async () => {}),
      getUserSettings: vi.fn(async () => null),
      upsertUserSettings: vi.fn(async (settings) => settings),
    },
    clock: () => FIXED_DATE,
    idGen: () => NOTIF_ID,
    emailIdGen: () => EMAIL_ID,
    enqueueImmediateEmail: vi.fn(async () => {}),
    organizationEmailStop: vi.fn(async (_organizationId: string) => 'none' as const),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn().mockReturnThis(),
    },
  }
}
