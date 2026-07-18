// Integration context — update connection visibility use case
// Steps: authorize → find connection → update visibility (+ fact, atomic)

import type { GoogleConnectionRepository } from '../ports/google-connection.repository'
import type { IntegrationCommandStore } from '../ports/integration-command-store.port'
import type { GoogleConnection } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { UpdateConnectionVisibilityInput } from '../dto/update-connection-visibility.dto'
export type { UpdateConnectionVisibilityInput } from '../dto/update-connection-visibility.dto'
import { canForContext } from '#/shared/domain/permissions'
import { googleConnectionId } from '#/shared/domain/ids'
import { integrationError } from '../../domain/errors'
import { integrationGoogleConnectionVisibilityChanged } from '../../domain/events'

export type UpdateConnectionVisibilityDeps = Readonly<{
  connectionRepo: GoogleConnectionRepository
  commandStore: IntegrationCommandStore
  clock: () => Date
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

    // 3. Update visibility + fact — atomic via the command store (BQC-3.5)
    const updatedConnection = await deps.commandStore.updateConnectionVisibility({
      organizationId: ctx.organizationId,
      connectionId,
      visibility: input.visibility,
      event: integrationGoogleConnectionVisibilityChanged({
        connectionId,
        organizationId: ctx.organizationId,
        visibility: input.visibility,
        occurredAt: deps.clock(),
      }),
    })

    return updatedConnection
  }

export type UpdateConnectionVisibility = ReturnType<typeof updateConnectionVisibility>
