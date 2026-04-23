// Capturing event bus — records emitted events for assertions in tests.
// Implements the same EventBus interface used in production code so use cases
// can't tell the difference.

import type { EventBus } from '#/shared/events/event-bus'
import type { DomainEvent } from '#/shared/events/events'

export type CapturingEventBus = EventBus & {
  /** All events emitted since the last clear. */
  readonly capturedEvents: ReadonlyArray<DomainEvent>
  /** Filter captured events by their _tag. */
  capturedByTag<T extends DomainEvent['_tag']>(
    tag: T,
  ): ReadonlyArray<Extract<DomainEvent, { _tag: T }>>
}

export function createCapturingEventBus(): CapturingEventBus {
  const captured: DomainEvent[] = []

  return {
    on() {
      // Capturing bus doesn't dispatch to handlers — it just records
    },

    async emit(event: DomainEvent) {
      captured.push(event)
    },

    clear() {
      captured.length = 0
    },

    get capturedEvents(): ReadonlyArray<DomainEvent> {
      return captured
    },

    capturedByTag<T extends DomainEvent['_tag']>(
      tag: T,
    ): ReadonlyArray<Extract<DomainEvent, { _tag: T }>> {
      return captured.filter(
        (e): e is Extract<DomainEvent, { _tag: T }> => e._tag === tag,
      )
    },
  }
}
