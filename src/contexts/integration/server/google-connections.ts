// Integration context — Google connection CRUD server functions
// Per architecture: thin — resolve auth → validate input → call use case → translate errors → return
// Never returns { success: false } — always throws on error.

import { createServerFn } from '@tanstack/react-start'
import { command } from '#/shared/commands/command.server'
import { getContainer } from '#/composition'
import { disconnectGoogleInputSchema } from '../connections/disconnect-google.contracts'
import { toGoogleConnectionDto } from '../connections/contracts'
import { integrationCommandErrors } from './error-helpers'

// ── listGoogleConnections ───────────────────────────────────────────

export const listGoogleConnections = createServerFn({ method: 'GET' }).handler(
  command(
    {
      method: 'GET',
      name: 'integration.listGoogleConnections',
      action: 'integration.manage',
      errors: integrationCommandErrors,
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
        errors: integrationCommandErrors,
      },
      async ({ data, actor }) => {
        const connection =
          await getContainer().integrationPublicApi.connections.disconnect(data, actor)
        return { connection: toGoogleConnectionDto(connection) }
      },
    ),
  )
