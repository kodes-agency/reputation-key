// Sequential integration command store — NON-transactional test/Storybook
// fake. Applies the same state → outbox → emit order as the production store
// without importing Drizzle into application-layer tests.

import { createRecordedOutbox, type RecordedOutbox } from './recorded-outbox'
import { integrationError } from '#/contexts/integration/domain/errors'
import type { GoogleConnectionRepository } from '#/contexts/integration/application/ports/google-connection.repository'
import type { IntegrationCommandStore } from '#/contexts/integration/application/ports/integration-command-store.port'

export function createSequentialIntegrationCommandStore(deps: {
  connectionRepo: GoogleConnectionRepository
  outbox?: RecordedOutbox
}): IntegrationCommandStore {
  const outbox = deps.outbox ?? createRecordedOutbox()
  const recordAndEmit = outbox.record

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
        command.event.userId,
        command.event.occurredAt,
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
