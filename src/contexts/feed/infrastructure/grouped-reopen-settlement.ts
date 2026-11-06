// Settling a grouped reopen once none of its items still stands.
//
// "5 items reopened at Hotel H" is one notice filed under the first item:
// closing that item says nothing about the other four. Each closed cycle reads
// back the grouped reopens still waiting
// on its Property, rebuilds the cycles each one stands for from the fact that
// raised it, and asks the work-state gate whether any of them is still open.

import {
  inboxItemId,
  type NotificationId,
  type OrganizationId,
  type PropertyId,
} from '#/shared/domain/ids'
import type { NotificationEmailRepositoryPort } from '../application/ports/notification-email-repository.port'
import type {
  GroupedReopenStorePort,
  WaitingGroupedReopen,
} from '../application/ports/grouped-reopen-store.port'
import type { NotificationWorkState } from '../application/notification-work-state'
import { SETTLED_EMAIL_REASON } from '../domain/notification-settlement'
import { isRecordPayload } from './outbox-payload-fields'

export type GroupedReopenSettlementDeps = Readonly<{
  groupedReopens: GroupedReopenStorePort
  emails: Pick<NotificationEmailRepositoryPort, 'cancelQueuedForNotifications'>
  workState: Pick<NotificationWorkState, 'isWaiting'>
}>

/**
 * The audience the grouped notice was queued under, rebuilt from its fact:
 * the cycles on this Property, the way the fan-out grouped them. `null` when
 * the fact does not have that shape; the gate then cannot judge the row, and
 * it stays as it stands.
 */
const groupedAudience = (
  source: unknown,
  propertyId: PropertyId,
): Readonly<{ first: string; audience: unknown }> | null => {
  if (!isRecordPayload(source) || !Array.isArray(source.reopened)) return null
  const cycles = source.reopened.flatMap((cycle: unknown) => {
    if (!isRecordPayload(cycle) || cycle.propertyId !== propertyId) return []
    const { propertyId: _property, ...ref } = cycle
    return [ref]
  })
  const first = cycles[0]?.inboxItemId
  if (typeof first !== 'string') return null
  return {
    first,
    audience: {
      kind: 'bulk_handling_cycle',
      cycles,
      actorUserId: typeof source.userId === 'string' ? source.userId : null,
    },
  }
}

/**
 * A finished row's id. A row a later grouped reopen
 * was folded into stands for items its first fact does not name, so it is
 * never judged by that fact alone.
 */
const finishedNotificationId = async (
  deps: GroupedReopenSettlementDeps,
  organizationId: OrganizationId,
  propertyId: PropertyId,
  row: WaitingGroupedReopen,
): Promise<NotificationId | null> => {
  if (row.coalescedCount > 1) return null
  const grouped = groupedAudience(row.source, propertyId)
  if (grouped === null) return null
  const work = await deps.workState.isWaiting({
    organizationId,
    type: 'inbox.bulk_reopened',
    resourceId: inboxItemId(grouped.first),
    audience: grouped.audience,
  })
  return work === false ? row.id : null
}

/** Settle the Property's grouped reopens with nothing left open; answers how many. */
export async function settleGroupedReopens(
  deps: GroupedReopenSettlementDeps,
  input: Readonly<{
    organizationId: OrganizationId
    propertyId: PropertyId
    resolvedAt: Date
  }>,
): Promise<number> {
  const waiting = await deps.groupedReopens.findWaiting({
    organizationId: input.organizationId,
    propertyId: input.propertyId,
  })
  const candidates = await Promise.all(
    waiting.map((row) =>
      finishedNotificationId(deps, input.organizationId, input.propertyId, row),
    ),
  )
  const finished = candidates.filter((id): id is NotificationId => id !== null)
  if (finished.length === 0) return 0

  const settled = await deps.groupedReopens.settle({
    organizationId: input.organizationId,
    ids: finished,
    resolvedAt: input.resolvedAt,
  })
  if (settled.length > 0) {
    await deps.emails.cancelQueuedForNotifications(
      settled,
      input.organizationId,
      SETTLED_EMAIL_REASON,
      input.resolvedAt,
    )
  }
  return settled.length
}
