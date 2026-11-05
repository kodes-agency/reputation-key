// In-memory fake of the profile-update command store for application tests. It is
// not atomic and never runs in production; PostgreSQL tests prove the real store
// (createAtomicPropertyCommandStore).

import { createRecordedOutbox, type RecordedOutbox } from './recorded-outbox'
import { propertyError } from '#/contexts/property/domain/errors'
import type { InMemoryPropertyRepo } from './in-memory-property-repo'
import type { PropertyCommandStore } from '#/contexts/property/application/ports/property-command-store.port'

export function createSequentialPropertyCommandStore(deps: {
  repo: InMemoryPropertyRepo
  outbox?: RecordedOutbox
}): PropertyCommandStore {
  const outbox = deps.outbox ?? createRecordedOutbox()
  const recordAndEmit = outbox.record

  return {
    updateProperty: async (command) => {
      const current = await deps.repo.findById(command.organizationId, command.propertyId)
      if (
        !current ||
        current.sourceEpoch !== command.expectedSourceEpoch ||
        current.profileVersion !== command.expectedProfileVersion
      ) {
        throw propertyError('stale_property', 'property changed before test update')
      }
      const committed = { ...current, ...command.patch }
      deps.repo.seed([committed])
      await recordAndEmit(command.event(committed))
      return committed
    },
  }
}
