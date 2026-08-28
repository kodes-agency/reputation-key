// Shared test fixtures for the insert-notification use case + job.
// Eliminates the duplicated fake-deps construction between the use-case tests
// and the job-handler tests. Mirrors the shared `buildTestX(overrides)` convention.

import { vi } from 'vitest'
import type { InsertNotificationDeps } from './insert-notification'
import type {
  Notification,
  NotificationEmail,
  NotificationPreference,
} from '../../domain/types'
import { notificationId, notificationEmailId } from '#/shared/domain/ids'

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
      findUnreadByUser: vi.fn(async () => []),
      readFeedHead: vi.fn(async () => ({
        page: { notifications: [], hasMore: false },
        unreadCount: 0,
        watermark: '2026-06-10T10:00:00.000Z',
      })),
      findByUser: vi.fn(async () => []),
      markRead: vi.fn(async () => {}),
      markAllRead: vi.fn(async () => {}),
      findUnreadByUserTypeResource: vi.fn(async () => null),
      refreshUnread: vi.fn(async () => {}),
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
      markAccepted: vi.fn(async () => {}),
      markDelayed: vi.fn(async () => {}),
      markFailed: vi.fn(async () => {}),
      markSuppressed: vi.fn(async () => {}),
      recordProviderState: vi.fn(async () => []),
      findDueRecipients: vi.fn(async () => []),
      findDueByUser: vi.fn(async () => []),
      suppressRecipient: vi.fn(async () => 0),
      isRecipientSuppressed: vi.fn(async () => false),
      findOpenDigestBatch: vi.fn(async () => null),
      findDigestBatchEntries: vi.fn(async () => []),
      prepareDigestBatch: vi.fn(async () => {
        throw new Error('prepareDigestBatch is outside this fixture scope')
      }),
      settleDigestBatch: vi.fn(async () => false),
    },
    preferenceRepo: {
      findForDelivery: vi.fn(async () => null),
      upsert: vi.fn(async () => ({}) as NotificationPreference),
      findByUser: vi.fn(async () => []),
      getUserSettings: vi.fn(async () => null),
      upsertUserSettings: vi.fn(async (settings) => settings),
    },
    clock: () => FIXED_DATE,
    idGen: () => NOTIF_ID,
    emailIdGen: () => EMAIL_ID,
    enqueueImmediateEmail: vi.fn(async () => {}),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn().mockReturnThis(),
    },
  }
}
