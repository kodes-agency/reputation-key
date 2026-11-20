// Feed notification surface — the grouped reopens still waiting on a Property.
//
// "5 items reopened" is filed under the first of its items, so the settlement
// keyed on (type, resource) cannot tell when it is finished: closing the first
// item says nothing about the other four. The fact that raised the notice
// names them all, so settlement reads it back and asks about each.

import type { NotificationId, OrganizationId, PropertyId } from '#/shared/domain/ids'

export type WaitingGroupedReopen = Readonly<{
  id: NotificationId
  /** More than one: a later grouped reopen was folded into this row. */
  coalescedCount: number
  /** The payload of the bulk-reopen fact that raised the notice. */
  source: unknown
}>

export type GroupedReopenStorePort = Readonly<{
  /** Still-waiting grouped reopens on the Property whose raising fact is still kept. */
  findWaiting(
    input: Readonly<{ organizationId: OrganizationId; propertyId: PropertyId }>,
  ): Promise<ReadonlyArray<WaitingGroupedReopen>>
  /** Stamp `resolvedAt` on those of `ids` still waiting, and answer with them. */
  settle(
    input: Readonly<{
      organizationId: OrganizationId
      ids: ReadonlyArray<NotificationId>
      resolvedAt: Date
    }>,
  ): Promise<ReadonlyArray<NotificationId>>
}>
