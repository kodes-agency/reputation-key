import { createServerFn } from '@tanstack/react-start'
import { headersFromContext } from './headers'
import { resolveTenantContext } from './middleware'
import { checkBetaCapability, type Capability } from './beta-capabilities'

export type ControlledRouteInput = Readonly<{
  capability: Capability
  featureLabel: string
  propertyId?: string
}>

/** Plain-data server boundary used by the client-side route redirect wrapper. */
export const checkControlledRoute = createServerFn({ method: 'GET' })
  .validator((data: ControlledRouteInput) => data)
  .handler(async ({ data }) => {
    const headers = await headersFromContext()
    const ctx = await resolveTenantContext(headers)
    return checkBetaCapability(ctx, data.capability, data.propertyId)
  })
