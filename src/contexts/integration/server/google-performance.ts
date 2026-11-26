import { createServerFn } from '@tanstack/react-start'
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { catchUntagged } from '#/shared/auth/server-errors'
import { disableResponseCaching } from '#/shared/http/no-store.server'
import { propertyId } from '#/shared/domain/ids'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import {
  getPropertyGooglePerformanceInputSchema,
  renewPropertyGooglePerformanceLeaseInputSchema,
} from '../performance/contracts'

export const getPropertyGooglePerformance = createServerFn({ method: 'GET' })
  .validator(getPropertyGooglePerformanceInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        disableResponseCaching()
        const headers = await headersFromContext()
        const actor = await resolveTenantContext(headers)
        const getPerformance = getContainer().integrationPublicApi.performance.get
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
      'GET',
      'integration.getPropertyGooglePerformance',
    ),
  )

export const renewPropertyGooglePerformanceLease = createServerFn({
  method: 'POST',
})
  .validator(renewPropertyGooglePerformanceLeaseInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        disableResponseCaching()
        const headers = await headersFromContext()
        const actor = await resolveTenantContext(headers)
        const renewLease = getContainer().integrationPublicApi.performance.renewLease
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
