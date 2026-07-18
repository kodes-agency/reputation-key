// Event bus — in-process event bus for cross-context communication.
// Per architecture: "Contexts communicate through domain events, never through direct internal imports."
// Handlers subscribe to events by _tag. Events are dispatched synchronously,
// handlers execute async side effects.
//
// TRADE-OFF: This is an in-process event bus. If the process crashes after a use case
// emits an event but before the handler completes, the event is lost. This is acceptable
// for current use cases (logging, cache invalidation). For critical side effects
// (e.g., sending transactional emails, creating audit records), consider migrating
// to BullMQ-backed event delivery for at-least-once processing guarantees.
// Evaluate BullMQ-based event persistence for critical events in Phase 4+.
//
// BQC-3.2: registrations that carry a catalogue consumer identity (`{ consumer }`)
// are authorized at emit time through an injected authorizer — the composition
// root wires it to the delayed execution gate (src/shared/jobs/delayed-execution-gate.ts)
// so dark-context handlers deny here instead of running ungated.

import type { DomainEvent } from './events'

export type EventBusOnOptions = Readonly<{
  /** Catalogue consumer module name (e.g. 'activity.event-handlers'). */
  consumer: string
}>

/**
 * BQC-3.2: decides whether a governed consumer may handle this event.
 * Injected by the composition root (wired to the delayed execution gate)
 * so the bus itself stays free of server-only policy imports — bare
 * createEventBus() (tests, Storybook, browser) runs ungoverned.
 */
export type BusConsumerAuthorizer = (
  consumer: string,
  event: DomainEvent,
) => Promise<boolean>

export type EventBusDeps = Readonly<{
  authorizeConsumer?: BusConsumerAuthorizer
}>

export type EventBus = Readonly<{
  /** Subscribe to events matching a specific _tag. */
  on<T extends DomainEvent['_tag']>(
    tag: T,
    handler: (event: Extract<DomainEvent, { _tag: T }>) => Promise<void>,
    opts?: EventBusOnOptions,
  ): void

  /**
   * Emit an event to all registered handlers.
   * TRADE-OFF: Handlers run concurrently via Promise.allSettled — no guaranteed
   * execution order. If one handler's side effects must complete before another
   * runs, enqueue a BullMQ job from the first handler and let the job trigger
   * the second handler.
   */
  emit(event: DomainEvent): Promise<void>

  /** Remove all handlers (useful for tests). */
  clear(): void
}>

type BusRegistration = Readonly<{
  handler: (event: DomainEvent) => Promise<void>
  consumer?: string
}>

/** In-process event bus implementation. */
export function createEventBus(deps?: EventBusDeps): EventBus {
  const handlers = new Map<string, Set<BusRegistration>>()

  return {
    on(tag, handler, opts) {
      if (!handlers.has(tag)) {
        handlers.set(tag, new Set())
      }
      handlers.get(tag)!.add({
        handler: handler as (event: DomainEvent) => Promise<void>,
        consumer: opts?.consumer,
      })
    },

    async emit(event) {
      const tagHandlers = handlers.get(event._tag)
      if (!tagHandlers) return

      // Run all handlers concurrently. Per architecture:
      // "Handlers should not throw. Failures are logged, not propagated to the emitter."
      await Promise.allSettled(
        Array.from(tagHandlers).map(async (registration) => {
          try {
            if (
              registration.consumer &&
              deps?.authorizeConsumer &&
              !(await deps.authorizeConsumer(registration.consumer, event))
            ) {
              return
            }
            await registration.handler(event)
          } catch (err) {
            // Per architecture: "Handlers should not throw. Failures are logged, not propagated to the emitter."
            // Lazy import avoids circular dep during bootstrap — getLogger() is safe at handler execution time.
            const { getLogger } = await import('#/shared/observability/logger')
            getLogger().error({ err, tag: event._tag }, 'event handler threw')
          }
        }),
      )
    },

    clear() {
      handlers.clear()
    },
  }
}
