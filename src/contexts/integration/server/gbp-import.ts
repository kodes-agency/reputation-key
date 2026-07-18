// Integration context — GBP import server functions
// Per architecture: thin — resolve auth → validate input → call use case → translate errors → return
// Never returns { success: false } — always throws on error.

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { getContainer } from '#/composition'
import { listLocationsInputSchema } from '../application/dto/list-locations.dto'
import { importPropertiesInputSchema } from '../application/dto/import-properties.dto'
import { importStatusInputSchema } from '../application/dto/import-status.dto'
import { isIntegrationError } from '../domain/errors'
import { integrationErrorStatus } from './error-helpers'

// ── listGbpLocations ───────────────────────────────────────────────

export const listGbpLocations = createServerFn({ method: 'POST' })
  .inputValidator(listLocationsInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({ actor: ctx, action: 'integration.manage' })

        try {
          const { useCases } = getContainer()
          const locations = await useCases.listGbpLocations(data, ctx)
          return { locations }
        } catch (e) {
          if (isIntegrationError(e))
            throwContextError('IntegrationError', e, integrationErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'POST',
      'integration.listGbpLocations',
    ),
  )

// ── startPropertyImport ────────────────────────────────────────────

export const startPropertyImport = createServerFn({ method: 'POST' })
  .inputValidator(importPropertiesInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({ actor: ctx, action: 'property.create' })

        try {
          const { useCases } = getContainer()
          // BQC-4.1: result carries region-gate skips alongside the job.
          const result = await useCases.startPropertyImport(data, ctx)
          return { job: result.job, skippedLocations: result.skippedLocations }
        } catch (e) {
          if (isIntegrationError(e))
            throwContextError('IntegrationError', e, integrationErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'POST',
      'integration.startPropertyImport',
    ),
  )

// ── getImportStatus ────────────────────────────────────────────────

export const getImportStatus = createServerFn({ method: 'POST' })
  .inputValidator(importStatusInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({ actor: ctx, action: 'integration.manage' })

        try {
          const { useCases } = getContainer()
          const job = await useCases.getImportStatus(data, ctx)
          return { job }
        } catch (e) {
          if (isIntegrationError(e))
            throwContextError('IntegrationError', e, integrationErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'POST',
      'integration.getImportStatus',
    ),
  )
