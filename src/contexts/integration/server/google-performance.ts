import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { catchUntagged } from '#/shared/auth/server-errors'
import { propertyId } from '#/shared/domain/ids'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import {
  getPropertyGooglePerformanceInputSchema,
  renewPropertyGooglePerformanceLeaseInputSchema,
} from '../application/dto/google-performance.dto'

function disableProviderContentCaching(): void {
  setResponseHeader('Cache-Control', 'private, no-store, max-age=0')
  setResponseHeader('Pragma', 'no-cache')
  setResponseHeader('Expires', '0')
}

export const getPropertyGooglePerformance = createServerFn({ method: 'POST' })
  .inputValidator(getPropertyGooglePerformanceInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        disableProviderContentCaching()
        const headers = await headersFromContext()
        const actor = await resolveTenantContext(headers)
        const getPerformance = getContainer().useCases.getPropertyGooglePerformance
        if (!getPerformance) {
          return {
            status: 'unavailable',
            reason: 'integration_unavailable',
            action: null,
          } as const
        }

        try {
          return await getPerformance({
            propertyId: propertyId(data.propertyId),
            preset: data.preset,
            actor,
          })
        } catch (error) {
          throw catchUntagged(error)
        }
      },
      'POST',
      'integration.getPropertyGooglePerformance',
    ),
  )

export const renewPropertyGooglePerformanceLease = createServerFn({
  method: 'POST',
})
  .inputValidator(renewPropertyGooglePerformanceLeaseInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        disableProviderContentCaching()
        const headers = await headersFromContext()
        const actor = await resolveTenantContext(headers)
        const renewLease = getContainer().useCases.renewGooglePerformanceLease
        if (!renewLease) return { ok: false } as const

        try {
          return await renewLease({
            propertyId: propertyId(data.propertyId),
            leaseRef: data.leaseRef,
            actor,
          })
        } catch {
          return { ok: false } as const
        }
      },
      'POST',
      'integration.renewPropertyGooglePerformanceLease',
    ),
  )
