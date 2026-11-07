import type { DomainEvent } from './events'
import { registerEventSchema, getEventSchema } from './schema-registry'
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

const definitions = new Map<string, EventDescriptor>(
  eventDescriptors.map((entry) => [`${entry.type}:v${entry.version}`, entry]),
)

/** Definitions remain available to the relay before container construction. */
export function getEventDescriptor(
  type: string,
  version: number,
): EventDescriptor | undefined {
  return getEventSchema(type, version) ?? definitions.get(`${type}:v${version}`)
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

/** Rebuilding a container may register the same fixed definitions again. */
export function registerAllEventSchemas(): void {
  for (const entry of eventDescriptors) {
    const registered = getEventSchema(entry.type, entry.version)
    if (registered === entry) continue
    registerEventSchema(entry)
  }
}
