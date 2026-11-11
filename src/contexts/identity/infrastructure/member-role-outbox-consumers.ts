// Identity's own reaction to a member's role change: finish the cleanup the
// changing request owes, when that request did not finish it.

import { validateEventPayload } from '#/shared/events/schema-registry'
import type { ConsumerRegistry } from '#/shared/outbox'
import {
  MEMBER_ROLE_CLEANUP_CONSUMER,
  type RoleChangeCleanup,
} from '../members/member-role-cleanup.server'

type MemberRoleChangedPayload = Readonly<{
  organizationId: string
  memberUserId: string
  userId: string
}>

export function registerMemberRoleConsumers(
  registry: ConsumerRegistry,
  deps: Readonly<{ cleanup: RoleChangeCleanup }>,
): void {
  registry.registerConsumer({
    eventType: 'identity.member.role_changed',
    consumerName: MEMBER_ROLE_CLEANUP_CONSUMER,
    module: 'identity.member-role-cleanup',
    handler: async (event) => {
      const payload = validateEventPayload(
        'identity.member.role_changed',
        event.eventVersion,
        event.payload,
      ) as MemberRoleChangedPayload | undefined
      if (!payload || payload.organizationId !== event.organizationId) {
        throw new Error(
          'Member role change envelope attribution does not match its payload',
        )
      }
      // The cleanup records the receipt after its effect.
      await deps.cleanup({
        eventId: event.eventId,
        organizationId: payload.organizationId,
        memberUserId: payload.memberUserId,
        actorUserId: payload.userId,
      })
      return { status: 'applied' }
    },
  })
}
