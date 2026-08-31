// Durable outbox consumer registration — public context-facing contract.
//
// Context infrastructure registers handlers here. The BullMQ dispatcher is
// deliberately a separate runtime module: importing this registry must never
// pull worker-only dependencies into context builds, readiness checks, or web
// bundles.
//
// ARC-03-T7 — the registry is CONTAINER-SCOPED, not process-global.
//
// RULE: a registry instance belongs to the container that created it. Nothing
// in this module holds registrations at module scope.
//
// WHY: this file used to own a module-level Map, and registerConsumer threw on
// a duplicate {eventType, consumerName}. Duplicate detection is the right
// behaviour — two consumers under one name silently share a receipt key — but
// with process-wide storage it also meant a SECOND container in the same
// process could not register its consumers at all: the first container's
// entries were still there, so every registration collided. Simulations, a
// worker that rebuilds its container, and any test that builds two containers
// were all blocked by a rule that was only ever meant to catch a naming
// mistake inside one runtime. Scoping the storage keeps the duplicate check
// exactly as strict, per container.

import type { ConsumerEvent } from './envelope'

export type { ConsumerEvent }

export type ConsumerHandler = (event: ConsumerEvent) => Promise<ConsumerResult>

export type ConsumerResult = Readonly<{
  /** 'applied' — consumer processed the event and committed state + receipt. */
  status: 'applied' | 'duplicate' | 'obsolete'
}>

export type ConsumerRegistration = Readonly<{
  /** Event type this consumer handles (e.g., 'review.received'). */
  eventType: string
  /** Consumer name — must be unique per event type. Used in receipts. */
  consumerName: string
  /**
   * The catalogue consumer-module row this consumer is authorized under.
   * Required — a default would silently authorize every context under one
   * row, which is exactly the mis-attribution this field exists to prevent.
   */
  module: string
  /** Handler function. Must commit state + receipt atomically. */
  handler: ConsumerHandler
}>

/** Consumer name + event type, the shape readiness and diagnostics consume. */
export type ConsumerListing = Readonly<{
  eventType: string
  consumerName: string
}>

export type ConsumerRegistry = Readonly<{
  /**
   * Register a consumer for an event type. Multiple consumers may register
   * for the same event type — each is invoked independently on dispatch.
   * Throws when this registry already holds the same consumer name for the
   * same event type.
   */
  registerConsumer: (registration: ConsumerRegistration) => void
  /** Worker-runtime lookup; not re-exported by the public outbox barrel. */
  listFor: (eventType: string) => ReadonlyArray<ConsumerRegistration>
  /** Registered consumers for readiness and operator diagnostics. */
  list: () => ReadonlyArray<ConsumerListing>
  /** Clear this registry — a test-isolation seam, not a production operation. */
  clear: () => void
}>

/** Create an independent, container-owned consumer registry. */
export function createConsumerRegistry(): ConsumerRegistry {
  const consumersByType = new Map<string, ConsumerRegistration[]>()

  return Object.freeze({
    registerConsumer(registration: ConsumerRegistration): void {
      const registrations = consumersByType.get(registration.eventType) ?? []
      if (
        registrations.some(
          (candidate) => candidate.consumerName === registration.consumerName,
        )
      ) {
        throw new Error(
          `Duplicate consumer "${registration.consumerName}" for event type "${registration.eventType}"`,
        )
      }
      registrations.push(registration)
      consumersByType.set(registration.eventType, registrations)
    },

    listFor(eventType: string): ReadonlyArray<ConsumerRegistration> {
      return consumersByType.get(eventType) ?? []
    },

    list(): ReadonlyArray<ConsumerListing> {
      const registered: ConsumerListing[] = []
      for (const [eventType, registrations] of consumersByType) {
        for (const registration of registrations) {
          registered.push({ eventType, consumerName: registration.consumerName })
        }
      }
      return registered
    },

    clear(): void {
      consumersByType.clear()
    },
  })
}
