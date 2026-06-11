// Integration context — Google connection CRUD server functions
// Per architecture: thin — resolve auth → validate input → call use case → translate errors → return
// Never returns { success: false } — always throws on error.

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { can } from '#/shared/domain/permissions'
import { getContainer } from '#/composition'
import { connectGoogleInputSchema } from '../application/dto/connect-google.dto'
import { disconnectGoogleInputSchema } from '../application/dto/disconnect-google.dto'
import { updateConnectionVisibilityInputSchema } from '../application/dto/update-connection-visibility.dto'
import { isIntegrationError } from '../domain/errors'
import { toGoogleConnectionDto } from '../application/dto/google-connection.dto'
import { integrationErrorStatus } from './error-helpers'

// ── connectGoogle ───────────────────────────────────────────────────

export const connectGoogle = createServerFn({ method: 'POST' })
  .inputValidator(connectGoogleInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        if (!can(ctx.role, 'integration.manage')) {
          throwContextError(
            'AuthError',
            {
              code: 'forbidden',
              message: 'Insufficient permissions to manage integrations',
            },
            403,
          )
        }

        try {
          const { useCases } = getContainer()
          const connection = await useCases.connectGoogleAccount(data, ctx)
          return { connection: toGoogleConnectionDto(connection) }
        } catch (e) {
          if (isIntegrationError(e))
            throwContextError('IntegrationError', e, integrationErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'POST',
      'integration.connectGoogle',
    ),
  )

// ── listGoogleConnections ───────────────────────────────────────────

export const listGoogleConnections = createServerFn({ method: 'GET' }).handler(
  tracedHandler(
    async () => {
      const headers = await headersFromContext()
      const ctx = await resolveTenantContext(headers)
      if (!can(ctx.role, 'integration.manage')) {
        throwContextError(
          'AuthError',
          {
            code: 'forbidden',
            message: 'Insufficient permissions to manage integrations',
          },
          403,
        )
      }

      try {
        const { useCases } = getContainer()
        const connections = await useCases.listGoogleConnections(ctx)
        return { connections: connections.map(toGoogleConnectionDto) }
      } catch (e) {
        if (isIntegrationError(e))
          throwContextError('IntegrationError', e, integrationErrorStatus(e.code))
        throw catchUntagged(e)
      }
    },
    'GET',
    'integration.listGoogleConnections',
  ),
)

// ── disconnectGoogle ────────────────────────────────────────────────

export const disconnectGoogle = createServerFn({ method: 'POST' })
  .inputValidator(disconnectGoogleInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        if (!can(ctx.role, 'integration.manage')) {
          throwContextError(
            'AuthError',
            {
              code: 'forbidden',
              message: 'Insufficient permissions to manage integrations',
            },
            403,
          )
        }

        try {
          const { useCases } = getContainer()
          const connection = await useCases.disconnectGoogleAccount(data, ctx)
          return { connection: toGoogleConnectionDto(connection) }
        } catch (e) {
          if (isIntegrationError(e))
            throwContextError('IntegrationError', e, integrationErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'POST',
      'integration.disconnectGoogle',
    ),
  )

// ── updateConnectionVisibility ──────────────────────────────────────

export const updateConnectionVisibility = createServerFn({ method: 'POST' })
  .inputValidator(updateConnectionVisibilityInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        if (!can(ctx.role, 'integration.manage')) {
          throwContextError(
            'AuthError',
            {
              code: 'forbidden',
              message: 'Insufficient permissions to manage integrations',
            },
            403,
          )
        }

        try {
          const { useCases } = getContainer()
          const connection = await useCases.updateConnectionVisibility(data, ctx)
          return { connection: toGoogleConnectionDto(connection) }
        } catch (e) {
          if (isIntegrationError(e))
            throwContextError('IntegrationError', e, integrationErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'POST',
      'integration.updateConnectionVisibility',
    ),
  )

// ── Re-exports from split files ─────────────────────────────────────

export { getGoogleAuthUrl } from './google-auth-url'
