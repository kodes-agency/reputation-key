// Portal context — does a scope have a Portal? A yes or a no, never a list.
//
// The Inbox's empty private-feedback queue explains where feedback comes from
// and, for someone who may create a Portal, offers to set one up, but only where
// the scope has none. It asks when that state shows, so the answer is one read
// of the Properties that hold a Portal (`listPortalManagementPropertyIds`),
// narrowed to the ones the execution policy lets this reader see, exactly as
// `listPortals` narrows its own list. Nothing of a Portal leaves with it.
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod/v4'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { listAuthorizedPortalPropertyIds } from './authorized-portal-properties.server'

const portalPresenceSchema = z.object({
  /** One Property; omitted, every Property the reader may see. */
  propertyId: z.string().min(1).optional(),
})

export const getPortalPresence = createServerFn({ method: 'GET' })
  .validator(portalPresenceSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        if (data.propertyId) {
          await requireExecutionAllowed({
            actor: ctx,
            action: 'portal.read',
            capability: 'portal.read',
            propertyId: data.propertyId,
          })
        }
        const propertyIds = await listAuthorizedPortalPropertyIds(ctx)
        return {
          hasPortal: data.propertyId
            ? propertyIds.includes(data.propertyId)
            : propertyIds.length > 0,
        }
      },
      'GET',
      'portal.getPortalPresence',
    ),
  )
