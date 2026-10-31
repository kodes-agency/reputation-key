import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod/v4'
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { catchUntagged } from '#/shared/auth/server-errors'
import { tracedHandler } from '#/shared/observability/traced-server-fn'

const scopeSchema = z.object({ propertyId: z.uuid().optional() })
const seenSchema = scopeSchema.extend({ entryIds: z.array(z.string().max(150)).max(500) })

export const getProductUpdatesFn = createServerFn({ method: 'GET' })
  .validator(scopeSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const actor = await resolveTenantContext(await headersFromContext())
        await requireExecutionAllowed({ actor, action: 'identity.profile.update' })
        try {
          return await getContainer().identityProductUpdates.get({ actor, ...data })
        } catch (error) {
          throw catchUntagged(error)
        }
      },
      'GET',
      'identity.getProductUpdates',
    ),
  )

export const claimProductUpdatesAutoOpenFn = createServerFn({ method: 'POST' })
  .validator(scopeSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const actor = await resolveTenantContext(await headersFromContext())
        await requireExecutionAllowed({ actor, action: 'identity.profile.update' })
        try {
          return await getContainer().identityProductUpdates.claim({ actor, ...data })
        } catch (error) {
          throw catchUntagged(error)
        }
      },
      'POST',
      'identity.claimProductUpdatesAutoOpen',
    ),
  )

export const markProductUpdatesSeenFn = createServerFn({ method: 'POST' })
  .validator(seenSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const actor = await resolveTenantContext(await headersFromContext())
        await requireExecutionAllowed({ actor, action: 'identity.profile.update' })
        try {
          await getContainer().identityProductUpdates.markSeen(
            { actor, propertyId: data.propertyId },
            data.entryIds,
          )
        } catch (error) {
          throw catchUntagged(error)
        }
      },
      'POST',
      'identity.markProductUpdatesSeen',
    ),
  )

export const setProductUpdatesAutoShowFn = createServerFn({ method: 'POST' })
  .validator(z.object({ autoShow: z.boolean() }))
  .handler(
    tracedHandler(
      async ({ data }) => {
        const actor = await resolveTenantContext(await headersFromContext())
        await requireExecutionAllowed({ actor, action: 'identity.profile.update' })
        try {
          await getContainer().identityProductUpdates.setAutoShow(actor, data.autoShow)
        } catch (error) {
          throw catchUntagged(error)
        }
      },
      'POST',
      'identity.setProductUpdatesAutoShow',
    ),
  )
