// Notification context — public API surface for cross-context consumers.
// Other contexts consume these types to interact with the notification context.
// Per architecture: contexts must not import from another context's internal layers.

// ── Domain type re-exports ────────────────────────────────────────────
export type {
  Notification,
  NotificationEmail,
  NotificationPreference,
  NotificationType,
  NotificationPriority,
  NotificationStatus,
  EmailQueueStatus,
  NotificationResourceType,
} from '../domain/types'

export { isUrgent, URGENT_TYPES } from '../domain/types'

// ── Constructor re-exports ────────────────────────────────────────────
export type { CreateNotificationInput } from '../domain/constructors'
export type { CreateNotificationEmailInput } from '../domain/constructors-email'
export type { CreateNotificationPreferenceInput } from '../domain/constructors-preference'

// ── Error re-exports ──────────────────────────────────────────────────
export type { NotificationError } from '../domain/errors'
export { notificationError } from '../domain/errors'

// ── Port type re-exports ──────────────────────────────────────────────
export type { NotificationRepositoryPort } from './ports/notification-repository.port'
export type { NotificationEmailRepositoryPort } from './ports/notification-email-repository.port'
export type { NotificationPreferenceRepositoryPort } from './ports/notification-preference-repository.port'
export type { UserLookupPort } from './ports/user-lookup.port'
export type { EmailSenderPort } from './ports/email-sender.port'
