// Sequential integration command store — NON-transactional test/Storybook
// fake (BQC-3.5). Lives in shared/testing (with the in-memory google
// connection / gbp import repos) so application-zone tests and browser
// bundles can use it without importing the drizzle-backed atomic store
// (application must not import infrastructure). Applies the same operation
// order (state → outbox → emit) against the repository ports without a
// real transaction.
//
// Not for production — production must use
// createAtomicIntegrationCommandStore
// (src/contexts/integration/infrastructure/integration-command-store.ts).

import type { EventBus } from '#/shared/events/event-bus'
import type { DomainEvent } from '#/shared/events/events'
import { getLogger } from '#/shared/observability/logger'
import { integrationError } from '#/contexts/integration/domain/errors'
import type { GoogleConnectionRepository } from '#/contexts/integration/application/ports/google-connection.repository'
import type { GbpImportRepository } from '#/contexts/integration/application/ports/gbp-import.repository'
import type { IntegrationCommandStore } from '#/contexts/integration/application/ports/integration-command-store.port'

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

export function createSequentialIntegrationCommandStore(deps: {
  connectionRepo: GoogleConnectionRepository
  importRepo?: GbpImportRepository
  events: EventBus
  recordOutbox?: (event: DomainEvent) => Promise<void>
}): IntegrationCommandStore {
  const recordAndEmit = async (event: DomainEvent): Promise<void> => {
    if (deps.recordOutbox) await deps.recordOutbox(event)
    await emitAfterCommit(deps.events, event)
  }

  return {
    connectGoogleAccount: async (command) => {
      await deps.connectionRepo.insert(command.connection)
      await recordAndEmit(command.event)
    },

    reconnectGoogleAccount: async (command) => {
      await deps.connectionRepo.updateReconnection(
        command.organizationId,
        command.connectionId,
        command.encryptedAccessToken,
        command.encryptedRefreshToken,
        command.tokenExpiresAt,
        command.visibility,
      )
      const updated = await deps.connectionRepo.findById(
        command.organizationId,
        command.connectionId,
      )
      if (!updated) {
        throw integrationError('connection_not_found', 'Google connection not found')
      }
      await recordAndEmit(command.event)
      return updated
    },

    disconnectGoogleAccount: async (command) => {
      await deps.connectionRepo.updateStatus(
        command.organizationId,
        command.connectionId,
        'disconnected',
      )
      await deps.connectionRepo.redactForDisconnect(
        command.organizationId,
        command.connectionId,
      )
      const updated = await deps.connectionRepo.findById(
        command.organizationId,
        command.connectionId,
      )
      if (!updated) {
        throw integrationError('connection_not_found', 'Google connection not found')
      }
      await recordAndEmit(command.event)
      return updated
    },

    updateConnectionVisibility: async (command) => {
      await deps.connectionRepo.updateVisibility(
        command.organizationId,
        command.connectionId,
        command.visibility,
      )
      const updated = await deps.connectionRepo.findById(
        command.organizationId,
        command.connectionId,
      )
      if (!updated) {
        throw integrationError('connection_not_found', 'Google connection not found')
      }
      await recordAndEmit(command.event)
      return updated
    },

    recordImportCompleted: async (command) => {
      if (!deps.importRepo)
        throw new Error('importRepo is required for recordImportCompleted')
      await deps.importRepo.updateStatus(
        command.organizationId,
        command.importJobId,
        command.finalStatus,
      )
      await recordAndEmit(command.event)
    },
  }
}
