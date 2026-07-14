// Emit-and-record utility — emits to the in-process event bus AND records
// to the outbox in one call (PRE17A A4 expand phase).
//
// During the expand phase, both paths run: the legacy in-process bus
// delivers events to existing consumers, and the outbox records them
// for verification. In the switch phase, the in-process bus is removed
// and the outbox becomes the sole delivery mechanism.
//
// Usage:
//   await emitAndRecord(deps.events, deps.outboxRepo, reviewCreated({...}))

import type { EventBus } from '#/shared/events/event-bus'
import type { DomainEvent } from '#/shared/events/events'
import type { OutboxRepository } from './infrastructure/outbox-repository'
import { toOutboxEvent } from './event-adapter'

/**
 * Emit a domain event to the in-process bus AND record it in the outbox.
 * The outbox insert is NOT yet atomic with the business write — that comes
 * in the switch phase when the command store is introduced.
 */
export async function emitAndRecord(
  events: EventBus,
  outboxRepo: OutboxRepository | undefined,
  event: DomainEvent,
): Promise<void> {
  await events.emit(event)
  if (outboxRepo) {
    await outboxRepo.insert({ ...toOutboxEvent(event), id: event.eventId })
  }
}
