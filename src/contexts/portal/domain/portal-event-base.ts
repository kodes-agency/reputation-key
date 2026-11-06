import { assert } from '#/shared/domain/assert'
import { newEventId } from '#/shared/domain/event-id'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'

export type PortalFact<Tag extends string, Payload> = Readonly<
  Payload & {
    _tag: Tag
    eventId: string
    organizationId: OrganizationId
    propertyId: PropertyId
    occurredAt: Date
    correlationId: string | null
  }
>

export type PortalLifecycleFact<Tag extends string, Payload> = PortalFact<
  Tag,
  Payload & { sourceAggregateVersion: string }
>

export type PortalEventArgs<T> = Omit<T, '_tag' | 'eventId' | 'correlationId'> &
  Readonly<{ correlationId?: string | null }>

export function assertPortalLifecycleFact(args: {
  occurredAt: Date
  sourceAggregateVersion: string
}): void {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  assert(
    !Number.isNaN(Date.parse(args.sourceAggregateVersion)) &&
      new Date(args.sourceAggregateVersion).toISOString() === args.sourceAggregateVersion,
    'sourceAggregateVersion must be an ISO timestamp',
  )
}

export function createPortalEvent<
  const T extends { _tag: string; correlationId?: string | null },
>(args: T) {
  return {
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
  }
}
