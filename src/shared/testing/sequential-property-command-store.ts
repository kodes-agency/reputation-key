// Sequential property command store — NON-transactional test/Storybook fake
// (BQC-3.5). Lives in shared/testing (with the in-memory property repo) so
// application-zone tests and browser bundles can use it without importing
// the drizzle-backed atomic store (application must not import
// infrastructure). Applies the same operation order (state → outbox → emit)
// against the repository port without a real transaction.
//
// Not for production — production must use createAtomicPropertyCommandStore
// (src/contexts/property/infrastructure/property-command-store.ts).

import type { EventBus } from '#/shared/events/event-bus'
import type { DomainEvent } from '#/shared/events/events'
import { getLogger } from '#/shared/observability/logger'
import { propertyError } from '#/contexts/property/domain/errors'
import type { PropertyRepository } from '#/contexts/property/application/ports/property.repository'
import type { PropertyCommandStore } from '#/contexts/property/application/ports/property-command-store.port'

/** Post-commit emit, failure-isolated — same contract as the atomic store. */
async function emitAfterCommit(events: EventBus, event: DomainEvent): Promise<void> {
  try {
    await events.emit(event)
  } catch (err) {
    getLogger().warn(
      { err, eventType: event._tag, eventId: event.eventId },
      'BQC-3.5: in-process emit failed after sequential store state write',
    )
  }
}

export function createSequentialPropertyCommandStore(deps: {
  repo: PropertyRepository
  events: EventBus
  recordOutbox?: (event: DomainEvent) => Promise<void>
}): PropertyCommandStore {
  const recordAndEmit = async (event: DomainEvent): Promise<void> => {
    if (deps.recordOutbox) await deps.recordOutbox(event)
    await emitAfterCommit(deps.events, event)
  }

  return {
    createProperty: async (command) => {
      // Tenant guard — same contract as the atomic store / repository.
      if (command.property.organizationId !== command.organizationId) {
        throw propertyError('forbidden', 'Tenant mismatch on property insert')
      }
      const inserted = await deps.repo.insertAndReturn(
        command.organizationId,
        command.property,
      )
      await recordAndEmit(command.event)
      return inserted
    },

    updateProperty: async (command) => {
      await deps.repo.update(command.organizationId, command.propertyId, command.patch)
      await recordAndEmit(command.event)
    },

    deleteProperty: async (command) => {
      await deps.repo.hardDelete(command.organizationId, command.propertyId)
      await recordAndEmit(command.event)
    },
  }
}
