// Integration context — update connection visibility use case
// Steps: authorize → find connection → update visibility

import type { GoogleConnectionRepository } from '../ports/google-connection.repository'
import type { EventBus } from '#/shared/events/event-bus'
import type { GoogleConnection } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { UpdateConnectionVisibilityInput } from '../dto/update-connection-visibility.dto'
export type { UpdateConnectionVisibilityInput } from '../dto/update-connection-visibility.dto'
import { canForContext } from '#/shared/domain/permissions'
import { googleConnectionId } from '#/shared/domain/ids'
import { integrationError } from '../../domain/errors'
import { integrationGoogleConnectionVisibilityChanged } from '../../domain/events'
import { emitAndRecord, type OutboxRepository } from '#/shared/outbox'

export type UpdateConnectionVisibilityDeps = Readonly<{
  connectionRepo: GoogleConnectionRepository
  events: EventBus
  clock: () => Date
  outboxRepo?: OutboxRepository
}>

export const updateConnectionVisibility =
  (deps: UpdateConnectionVisibilityDeps) =>
  async (
    input: UpdateConnectionVisibilityInput,
    ctx: AuthContext,
  ): Promise<GoogleConnection> => {
    // 1. Authorize
    if (!canForContext(ctx, 'integration.manage')) {
      throw integrationError(
        'forbidden',
        'You do not have permission to manage integrations',
      )
    }

    const connectionId = googleConnectionId(input.connectionId)

    // 2. Find connection
    const connection = await deps.connectionRepo.findById(
      ctx.organizationId,
      connectionId,
    )
    if (!connection) {
      throw integrationError('connection_not_found', 'Google connection not found')
    }

    // 3. Update visibility
    await deps.connectionRepo.updateVisibility(
      ctx.organizationId,
      connectionId,
      input.visibility,
    )

    const updatedConnection = await deps.connectionRepo.findById(
      ctx.organizationId,
      connectionId,
    )
    if (!updatedConnection) {
      throw integrationError('connection_not_found', 'Connection not found after update')
    }

    // 4. Emit event
    await emitAndRecord(
      deps.events,
      deps.outboxRepo,
      integrationGoogleConnectionVisibilityChanged({
        connectionId,
        organizationId: ctx.organizationId,
        visibility: input.visibility,
        occurredAt: deps.clock(),
      }),
    )

    return updatedConnection
  }

export type UpdateConnectionVisibility = ReturnType<typeof updateConnectionVisibility>
