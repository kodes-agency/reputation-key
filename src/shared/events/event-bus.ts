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
// TODO: Evaluate BullMQ-based event persistence for critical events in Phase 4+.

import type { DomainEvent } from './events'

export type EventBus = Readonly<{
  /** Subscribe to events matching a specific _tag. */
  on<T extends DomainEvent['_tag']>(
    tag: T,
    handler: (event: Extract<DomainEvent, { _tag: T }>) => Promise<void>,
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

/** In-process event bus implementation. */
export function createEventBus(): EventBus {
  const handlers = new Map<string, Set<(event: DomainEvent) => Promise<void>>>()

  return {
    on(tag, handler) {
      if (!handlers.has(tag)) {
        handlers.set(tag, new Set())
      }
      handlers.get(tag)!.add(handler as (event: DomainEvent) => Promise<void>)
    },

    async emit(event) {
      const tagHandlers = handlers.get(event._tag)
      if (!tagHandlers) return

      // Run all handlers concurrently. Per architecture:
      // "Handlers should not throw. Failures are logged, not propagated to the emitter."
      await Promise.allSettled(
        Array.from(tagHandlers).map(async (handler) => {
          try {
            await handler(event)
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
