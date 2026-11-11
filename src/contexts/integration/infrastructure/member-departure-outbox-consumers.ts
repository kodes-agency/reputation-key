// Integration's reaction to a member leaving or losing the AccountAdmin role:
// release the Google authority they held, from the fact that commits with the
// membership change. The member row's trigger already fenced their connections
// in that commit; this fences anything it could not see and cancels the
// imports those connections and this user started.
//
// Both handlers are safe to repeat (a second fence finds nothing to
// transition, a second cancel finds nothing open), so the receipt follows them.

import type { ConsumerEvent, ConsumerRegistry, OutboxRepository } from '#/shared/outbox'
import { validateEventPayload } from '#/shared/events/schema-registry'
import { organizationId, userId } from '#/shared/domain/ids'
import { ADMIN_ROLE } from '#/shared/domain/roles'
import type { PrepareGoogleConnectorDeparture } from '../application/use-cases/prepare-google-connector-departure'
import type { ActiveMemberAuthResolver } from './active-member-auth.adapter'

const MEMBER_DEPARTURE_MODULE = 'integration.member-departure'

export type MemberDepartureConsumerDeps = Readonly<{
  prepareDeparture: PrepareGoogleConnectorDeparture
  cancelImportsForUser: (organizationId: string, userId: string) => Promise<unknown>
  resolveActiveMember: ActiveMemberAuthResolver
  receipts: Pick<OutboxRepository, 'insertReceipt'>
}>

type MemberFact = Readonly<{ organizationId: string; userId: string }>

function parseFact(
  event: ConsumerEvent,
  userField: 'userId' | 'memberUserId',
): MemberFact & Readonly<{ payload: Record<string, unknown> }> {
  const payload = validateEventPayload(
    event.eventType,
    event.eventVersion,
    event.payload,
  ) as Record<string, unknown> | undefined
  const member = payload?.[userField]
  if (
    !payload ||
    payload.organizationId !== event.organizationId ||
    typeof member !== 'string'
  ) {
    throw new Error('Member departure envelope attribution does not match its payload')
  }
  return { organizationId: event.organizationId, userId: member, payload }
}

export function registerMemberDepartureConsumers(
  registry: ConsumerRegistry,
  deps: MemberDepartureConsumerDeps,
): void {
  registry.registerConsumer({
    eventType: 'identity.member.removed',
    consumerName: 'integration.on-member-removed',
    module: MEMBER_DEPARTURE_MODULE,
    handler: async (event) => {
      const fact = parseFact(event, 'userId')
      // Invited again and accepted before this fact was delivered: what they
      // hold now belongs to the later membership.
      const rejoined = await deps.resolveActiveMember(fact.organizationId, fact.userId)
      if (rejoined) {
        await deps.receipts.insertReceipt(
          event.eventId,
          'integration.on-member-removed',
          'obsolete',
        )
        return { status: 'obsolete' }
      }
      await deps.prepareDeparture({
        organizationId: organizationId(fact.organizationId),
        connectorUserId: userId(fact.userId),
        cause: 'member_removed',
      })
      await deps.cancelImportsForUser(fact.organizationId, fact.userId)
      await deps.receipts.insertReceipt(
        event.eventId,
        'integration.on-member-removed',
        'applied',
      )
      return { status: 'applied' }
    },
  })

  registry.registerConsumer({
    eventType: 'identity.member.role_changed',
    consumerName: 'integration.on-member-role-changed',
    module: MEMBER_DEPARTURE_MODULE,
    handler: async (event) => {
      const fact = parseFact(event, 'memberUserId')
      const lostAdmin =
        fact.payload.previousRole === ADMIN_ROLE && fact.payload.newRole !== ADMIN_ROLE
      // Made an AccountAdmin again since: their connections are theirs to use.
      const current = lostAdmin
        ? await deps.resolveActiveMember(fact.organizationId, fact.userId)
        : null
      if (!lostAdmin || current?.role === ADMIN_ROLE) {
        await deps.receipts.insertReceipt(
          event.eventId,
          'integration.on-member-role-changed',
          'obsolete',
        )
        return { status: 'obsolete' }
      }
      await deps.prepareDeparture({
        organizationId: organizationId(fact.organizationId),
        connectorUserId: userId(fact.userId),
        cause: 'account_admin_role_lost',
      })
      await deps.receipts.insertReceipt(
        event.eventId,
        'integration.on-member-role-changed',
        'applied',
      )
      return { status: 'applied' }
    },
  })
}
