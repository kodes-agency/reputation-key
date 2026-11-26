// Integration context — Google connection CRUD server functions
// Per architecture: thin — resolve auth → validate input → call use case → translate errors → return
// Never returns { success: false } — always throws on error.

import { createServerFn } from '@tanstack/react-start'
import { command } from '#/shared/commands/command.server'
import type { CommandErrors } from '#/shared/commands/contracts'
import { getContainer } from '#/composition'
import { disconnectGoogleInputSchema } from '../connections/disconnect-google.contracts'
import { isIntegrationError, type IntegrationError } from '../domain/errors'
import { toGoogleConnectionDto } from '../connections/contracts'
import { integrationErrorStatus } from './error-helpers'

const integrationErrors: CommandErrors<IntegrationError> = {
  name: 'IntegrationError',
  is: isIntegrationError,
  status: integrationErrorStatus,
}

// ── listGoogleConnections ───────────────────────────────────────────

export const listGoogleConnections = createServerFn({ method: 'GET' }).handler(
  command(
    {
      method: 'GET',
      name: 'integration.listGoogleConnections',
      action: 'integration.manage',
      errors: integrationErrors,
    },
    async ({ actor }) => {
      const connections =
        await getContainer().integrationPublicApi.connections.list(actor)
      return { connections: connections.map(toGoogleConnectionDto) }
    },
  ),
)

// ── disconnectGoogle ────────────────────────────────────────────────

export const disconnectGoogle = createServerFn({ method: 'POST' })
  .validator(disconnectGoogleInputSchema)
  .handler(
    command(
      {
        method: 'POST',
        name: 'integration.disconnectGoogle',
        action: 'integration.manage',
        errors: integrationErrors,
      },
      async ({ data, actor }) => {
        const connection =
          await getContainer().integrationPublicApi.connections.disconnect(data, actor)
        return { connection: toGoogleConnectionDto(connection) }
      },
    ),
  )
