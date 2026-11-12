// Inbox's reaction to a member's removal: release, from the fact that commits
// with the membership delete, the Inbox assignments the member may no longer
// hold. Each requirement is re-proved, so a member invited again before the
// fact was delivered keeps what they may now work on.

import { eventConsumerReceipts } from '#/shared/db/schema/outbox.schema'
import type { Database } from '#/shared/db'
import { organizationId, userId } from '#/shared/domain/ids'
import type { ConsumerRegistry } from '#/shared/outbox'
import { removedMemberConsumerHandler } from '#/shared/removed-member-consumer'
import type { InboxCommandStore } from '../application/ports/inbox-command-store.port'

export type InboxMemberOffboardingConsumerDeps = Readonly<{
  db: Pick<Database, 'insert'>
  commandStore: Pick<InboxCommandStore, 'releaseIneligibleAssignmentsForUser'>
  clock: () => Date
}>

export function registerInboxMemberOffboardingConsumers(
  registry: ConsumerRegistry,
  deps: InboxMemberOffboardingConsumerDeps,
): void {
  registry.registerConsumer({
    eventType: 'identity.member.removed',
    consumerName: 'inbox.on-member-removed',
    module: 'inbox.member-offboarding',
    handler: removedMemberConsumerHandler({
      consumerName: 'inbox.on-member-removed',
      release: (member) =>
        deps.commandStore.releaseIneligibleAssignmentsForUser({
          organizationId: organizationId(member.organizationId),
          userId: userId(member.userId),
          actorId: member.removedBy === null ? null : userId(member.removedBy),
          releaseReason: 'member_offboarded',
          at: deps.clock(),
        }),
      receipts: {
        insertReceipt: async (eventId, consumerName, status) => {
          await deps.db
            .insert(eventConsumerReceipts)
            .values({ eventId, consumerName, status })
            .onConflictDoNothing()
        },
      },
    }),
  })
}
