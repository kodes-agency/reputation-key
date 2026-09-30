// Portal context — shared shape and guard for the domain event modules
// (events.ts, portal-link-events.ts, portal-group-events.ts).

import { assert } from '#/shared/domain/assert'

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
