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
// are authorized at emit time through the delayed execution gate — dark-context
// handlers deny here instead of running ungated.

import type { DomainEvent } from './events'
import { gateBusConsumer } from '#/shared/jobs/delayed-execution-gate'

export type EventBusOnOptions = Readonly<{
  /** Catalogue consumer module name (e.g. 'activity.event-handlers'). */
  consumer: string
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

/**
 * BQC-3.2: authorize a governed consumer against current policy.
 * deny_terminal skips with a warning; deny_retry skips with an error — the
 * bus is fire-and-forget with no retry semantics, so retries belong to the
 * durable dispatcher path (BQC-3.3–3.5), not here.
 */
async function authorizeConsumer(consumer: string, event: DomainEvent): Promise<boolean> {
  const outcome = await gateBusConsumer(consumer, event)
  if (outcome.kind === 'allow') return true
  // Lazy import avoids circular dep during bootstrap — same pattern as the
  // handler-failure catch below.
  const { getLogger } = await import('#/shared/observability/logger')
  if (outcome.kind === 'deny_terminal') {
    getLogger().warn(
      { consumer, tag: event._tag, reason: outcome.decision.reason },
      'delayed execution denied — terminal (event bus consumer skipped)',
    )
    return false
  }
  getLogger().error(
    { consumer, tag: event._tag, reason: outcome.decision.reason },
    'delayed execution denied — policy unavailable (event bus consumer skipped)',
  )
  return false
}

/** In-process event bus implementation. */
export function createEventBus(): EventBus {
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
              !(await authorizeConsumer(registration.consumer, event))
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
