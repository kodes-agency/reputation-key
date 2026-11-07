import type { z } from 'zod/v4'

/** One issued event format and its identifier-only persistence contract. */
export type EventDescriptor = Readonly<{
  type: string
  version: number
  schema: z.ZodType<unknown>
  aggregate:
    | Readonly<{ type: string; id: string }>
    | ((payload: Readonly<Record<string, unknown>>, eventId: string) => AggregateIdentity)
  /** Omit for an unconditional format; older formats remain decodable. */
  emits?: (event: Readonly<Record<string, unknown>>) => boolean
}>

export type AggregateIdentity = Readonly<{ id: string; type: string }>

/** Missing historical identifiers retain the explicit event-id sentinel. */
export function resolveEventAggregate(
  descriptor: EventDescriptor | undefined,
  payload: object,
  eventId: string,
): AggregateIdentity {
  const fields = payload as Readonly<Record<string, unknown>>
  if (typeof descriptor?.aggregate === 'function') {
    return descriptor.aggregate(fields, eventId)
  }
  const id = descriptor ? fields[descriptor.aggregate.id] : undefined
  return descriptor && id != null
    ? { id: String(id), type: descriptor.aggregate.type }
    : { id: eventId, type: 'event' }
}
