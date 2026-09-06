// Recorded outbox - the in-memory stand-in for the `outbox_events` table used
// by the sequential command-store fakes. Every fact a store would have
// inserted in its commit transaction lands here, in commit order. Tests assert
// on it directly: there is no in-process bus, so nothing is "emitted" - a fact
// exists exactly when its outbox row does.

import type { DomainEvent } from '#/shared/events/events'

export type RecordedOutbox = Readonly<{
  /** Every recorded fact since the last clear, in commit order. */
  readonly facts: ReadonlyArray<DomainEvent>
  /** Recorded facts of one type. */
  byTag<T extends DomainEvent['_tag']>(
    tag: T,
  ): ReadonlyArray<Extract<DomainEvent, { _tag: T }>>
  /** The store-side sink; mirrors `insertOutboxRow`. */
  record(event: DomainEvent): Promise<void>
  clear(): void
}>

export function createRecordedOutbox(): RecordedOutbox {
  const facts: DomainEvent[] = []
  return {
    get facts(): ReadonlyArray<DomainEvent> {
      return facts
    },
    byTag<T extends DomainEvent['_tag']>(tag: T) {
      return facts.filter(
        (event): event is Extract<DomainEvent, { _tag: T }> => event._tag === tag,
      )
    },
    async record(event) {
      facts.push(event)
    },
    clear() {
      facts.length = 0
    },
  }
}
