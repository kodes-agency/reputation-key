// Emit-and-record utility — emits to the in-process event bus AND records
// to the outbox in one call (PRE17A A4 expand phase / BQR-2.5).
//
// During the expand phase, both paths run: the legacy in-process bus
// delivers events to existing consumers, and the outbox records them
// when a schema is registered (allowlist-validated). Unregistered types
// still emit on the bus but skip the durable outbox.
//
// Usage:
//   await emitAndRecord(deps.events, deps.outboxRepo, reviewCreated({...}))

import type { EventBus } from '#/shared/events/event-bus'
import type { DomainEvent } from '#/shared/events/events'
import type { OutboxRepository } from './infrastructure/outbox-repository'
import { tryToOutboxEvent } from './event-adapter'
import { getLogger } from '#/shared/observability/logger'

/**
 * Emit a domain event to the in-process bus AND record it in the outbox
 * when a schema is registered. Outbox payload is allowlist-validated (BQR-2.5).
 * The outbox insert is NOT atomic with the business write unless the caller
 * uses a context command store (see review ReviewCommandStore, BQR-2.3).
 */
export async function emitAndRecord(
  events: EventBus,
  outboxRepo: OutboxRepository | undefined,
  event: DomainEvent,
): Promise<void> {
  await events.emit(event)
  if (!outboxRepo) return

  const row = tryToOutboxEvent(event)
  if (!row) {
    getLogger().debug(
      { eventType: event._tag, eventId: event.eventId },
      'BQR-2.5: skipping outbox insert for unregistered event type',
    )
    return
  }

  await outboxRepo.insert({ ...row, id: event.eventId })
}
