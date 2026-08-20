// Sequential integration command store — NON-transactional test/Storybook
// fake. Applies the same state → outbox → emit order as the production store
// without importing Drizzle into application-layer tests.

import type { EventBus } from '#/shared/events/event-bus'
import type { DomainEvent } from '#/shared/events/events'
import { getLogger } from '#/shared/observability/logger'
import { integrationError } from '#/contexts/integration/domain/errors'
import type { GoogleConnectionRepository } from '#/contexts/integration/application/ports/google-connection.repository'
import type { IntegrationCommandStore } from '#/contexts/integration/application/ports/integration-command-store.port'

/** Post-commit emit, failure-isolated — same contract as the atomic store. */
async function emitAfterCommit(events: EventBus, event: DomainEvent): Promise<void> {
  try {
    await events.emit(event)
  } catch (err) {
    getLogger().warn(
      { err, eventType: event._tag, correlationId: event.correlationId ?? undefined },
      'BQC-3.5: in-process emit failed after sequential store state write',
    )
  }
}

export function createSequentialIntegrationCommandStore(deps: {
  connectionRepo: GoogleConnectionRepository
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
        command.googleSubject,
        command.encryptedAccessToken,
        command.encryptedRefreshToken,
        command.tokenExpiresAt,
        command.visibility,
        command.scopes,
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
  }
}
