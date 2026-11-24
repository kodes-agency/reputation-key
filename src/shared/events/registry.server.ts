import type { DomainEvent } from './events'
import type { EventDescriptor } from './descriptor'
import { reviewEventDescriptors } from './review-event-descriptors'
import { inboxEventDescriptors } from './inbox-event-descriptors'
import { metricEventDescriptors } from './metric-event-descriptors'
import { propertyEventDescriptors } from './property-event-descriptors'
import { guestEventDescriptors } from './guest-event-descriptors'
import { identityEventDescriptors } from './identity-event-descriptors'
import { integrationEventDescriptors } from './integration-event-descriptors'
import { portalEventDescriptors } from './portal-event-descriptors'
import { aiEventDescriptors } from './ai-event-schemas'
import { goalEventDescriptors } from './goal-event-schemas'
import { identityAccessEventDescriptors } from './identity-access-event-schemas'
import { inboxItemEventDescriptors } from './inbox-item-event-schemas'

const descriptors = [
  ...reviewEventDescriptors,
  ...inboxEventDescriptors,
  ...metricEventDescriptors,
  ...propertyEventDescriptors,
  ...guestEventDescriptors,
  ...identityEventDescriptors,
  ...integrationEventDescriptors,
  ...portalEventDescriptors,
  ...aiEventDescriptors,
  ...goalEventDescriptors,
  ...identityAccessEventDescriptors,
  ...inboxItemEventDescriptors,
] as const satisfies readonly EventDescriptor[]

export type DefinedEventType = (typeof descriptors)[number]['type']
export const eventDescriptors: readonly EventDescriptor[] = descriptors

/** Every event type the outbox routes, with or without a durable consumer. */
export const EVENT_TYPES: ReadonlySet<string> = new Set(
  eventDescriptors.map(({ type }) => type),
)

const definitions = new Map<string, EventDescriptor>()
for (const entry of eventDescriptors) {
  const key = `${entry.type}:v${entry.version}`
  if (definitions.has(key)) {
    throw new Error(
      `Duplicate event schema: ${key} is defined twice. ` +
        'Each event type+version must be defined exactly once.',
    )
  }
  definitions.set(key, entry)
}

/**
 * Look up the descriptor for an event type and version.
 * Returns undefined for unknown types — the caller must reject.
 */
export function getEventDescriptor(
  type: string,
  version: number,
): EventDescriptor | undefined {
  return definitions.get(`${type}:v${version}`)
}

/** Select the issued format, retaining historical decoders separately. */
export function emittedEventVersion(
  event: Pick<DomainEvent, '_tag'> & Readonly<Record<string, unknown>>,
): number {
  let version = 1
  for (const entry of eventDescriptors) {
    if (
      entry.type === event._tag &&
      entry.version > version &&
      (!entry.emits || entry.emits(event))
    )
      version = entry.version
  }
  return version
}
