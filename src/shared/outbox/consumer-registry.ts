// Durable outbox consumer registration — public context-facing contract.
//
// Context infrastructure registers handlers here. The BullMQ dispatcher is
// deliberately a separate runtime module: importing this registry must never
// pull worker-only dependencies into context builds, readiness checks, or web
// bundles.

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

const consumersByType = new Map<string, ConsumerRegistration[]>()

/**
 * Register a consumer for an event type.
 * Multiple consumers can register for the same event type — each is invoked
 * independently when the event is dispatched.
 */
export function registerConsumer(registration: ConsumerRegistration): void {
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
}

/** Worker-runtime lookup; not re-exported by the public outbox barrel. */
export function registeredConsumersFor(
  eventType: string,
): readonly ConsumerRegistration[] {
  return consumersByType.get(eventType) ?? []
}

/** Clear all consumers — a test-isolation seam, not a production operation. */
export function clearConsumers(): void {
  consumersByType.clear()
}

/** List registered consumers for readiness and operator diagnostics. */
export function listRegisteredConsumers(): ReadonlyArray<
  Readonly<{ eventType: string; consumerName: string }>
> {
  const registered: Array<{ eventType: string; consumerName: string }> = []
  for (const [eventType, registrations] of consumersByType) {
    for (const registration of registrations) {
      registered.push({ eventType, consumerName: registration.consumerName })
    }
  }
  return registered
}
