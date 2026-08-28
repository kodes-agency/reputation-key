import type { OrganizationId, UserId } from '#/shared/domain/ids'

export const ORGANIZATION_ACCOUNT_NOTIFICATION_EVENT_TYPES = [
  'identity.invitation.accepted',
  'identity.member.role_changed',
  'identity.member.removed',
] as const

export type OrganizationAccountNotificationEventType =
  (typeof ORGANIZATION_ACCOUNT_NOTIFICATION_EVENT_TYPES)[number]

/**
 * Identity-owned durable fact authority for the exact account affected by an
 * Organization access change. This deliberately does not consult current
 * membership: a removed user must still receive their removal notice.
 */
export type OrganizationAccountNotificationAuthorityPort = Readonly<{
  isAffectedRecipient(input: {
    eventId: string
    eventType: OrganizationAccountNotificationEventType
    organizationId: OrganizationId
    userId: UserId
  }): Promise<boolean>
}>
