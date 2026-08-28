import { and, eq, isNull } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { outboxEvents } from '#/shared/db/schema/outbox.schema'
import { userId, type OrganizationId, type UserId } from '#/shared/domain/ids'
import { validateEventPayload } from '#/shared/events/schema-registry'
import type {
  OrganizationAccountNotificationAuthorityPort,
  OrganizationAccountNotificationEventType,
} from '../../application/ports/organization-account-notification-authority.port'

type IdentityAccountPayload = Readonly<{
  organizationId: string
  userId: string
  memberUserId?: string
}>

/**
 * Resolve the affected account from a schema-validated Identity fact. Role
 * changes carry both actor (`userId`) and target (`memberUserId`); confusing
 * them would notify the administrator who made the change instead of the
 * member whose access changed.
 */
export function affectedUserFromIdentityFact(input: {
  eventType: OrganizationAccountNotificationEventType
  eventVersion: number
  organizationId: OrganizationId
  payload: unknown
}): UserId {
  const payload = validateEventPayload(
    input.eventType,
    input.eventVersion,
    input.payload,
  ) as IdentityAccountPayload
  if (payload.organizationId !== input.organizationId) {
    throw new Error('Identity account-notification envelope attribution mismatch')
  }
  if (input.eventType === 'identity.member.role_changed') {
    if (!payload.memberUserId) {
      throw new Error('Identity role-change target is missing')
    }
    return userId(payload.memberUserId)
  }
  return userId(payload.userId)
}

/**
 * Re-read the exact unfenced durable Identity fact at worker execution. This
 * is the authority for account removals as well as current memberships, so a
 * removed user remains eligible for their own mandatory notice while a queue
 * candidate cannot redirect it to another recipient.
 */
export const createOrganizationAccountNotificationAuthority = (
  db: Database,
): OrganizationAccountNotificationAuthorityPort => ({
  isAffectedRecipient: async (input): Promise<boolean> => {
    const rows = await db
      .select({
        eventVersion: outboxEvents.eventVersion,
        payload: outboxEvents.payload,
      })
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.id, input.eventId),
          eq(outboxEvents.eventType, input.eventType),
          eq(outboxEvents.organizationId, input.organizationId),
          eq(outboxEvents.sourceContext, 'identity'),
          isNull(outboxEvents.recoveryFencedAt),
        ),
      )
      .limit(1)
    const row = rows[0]
    if (!row) return false
    return (
      affectedUserFromIdentityFact({
        eventType: input.eventType,
        eventVersion: row.eventVersion,
        organizationId: input.organizationId,
        payload: row.payload,
      }) === input.userId
    )
  },
})
