// The outbox handler every owner of a removed member's responsibilities
// registers under its own consumer name.
//
// `identity.member.removed` commits with the membership delete on every path
// that removes a member (removal, the offboarding repair). Each owner releases
// from it what the member held with that owner.

import { validateEventPayload } from '#/shared/events/schema-registry'
import type { ConsumerEvent, ConsumerResult, OutboxRepository } from '#/shared/outbox'
import type { RemovedMember } from '#/shared/responsible-manager-eligibility'

export type RemovedMemberConsumerDeps = Readonly<{
  /** The registering consumer's own name: the receipt is recorded under it. */
  consumerName: string
  release: (member: RemovedMember) => Promise<unknown>
  receipts: Pick<OutboxRepository, 'insertReceipt'>
}>

type MemberRemovedPayload = Readonly<{
  organizationId: string
  userId: string
  removedBy?: string | null
}>

function parseMemberRemoved(event: ConsumerEvent): RemovedMember {
  const payload = validateEventPayload(
    'identity.member.removed',
    event.eventVersion,
    event.payload,
  ) as MemberRemovedPayload | undefined
  if (!payload || payload.organizationId !== event.organizationId) {
    throw new Error('Member removal envelope attribution does not match its payload')
  }
  return {
    organizationId: payload.organizationId,
    userId: payload.userId,
    removedBy: payload.removedBy ?? null,
  }
}

/**
 * Release what the removed member still holds, then record the receipt. The
 * release is safe to repeat, so the receipt follows it: a crash between the two
 * redelivers the fact and the second run finds nothing left.
 */
export const removedMemberConsumerHandler =
  (deps: RemovedMemberConsumerDeps) =>
  async (event: ConsumerEvent): Promise<ConsumerResult> => {
    await deps.release(parseMemberRemoved(event))
    await deps.receipts.insertReceipt(event.eventId, deps.consumerName, 'applied')
    return { status: 'applied' }
  }
