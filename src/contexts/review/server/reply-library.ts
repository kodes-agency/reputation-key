import { createServerFn } from '@tanstack/react-start'
import { getContainer } from '#/composition'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { catchUntagged, throwContextError } from '#/shared/auth/server-errors'
import type { AuthContext } from '#/shared/domain/auth-context'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import {
  propertyReplyLibraryInputSchema,
  savePropertyReplyProfileInputSchema,
  savePropertyReplyTemplateInputSchema,
  setPropertyReplyTemplateEnabledInputSchema,
} from '../application/dto/reply-library.dto'
import { isReviewError } from '../domain/errors'
import { reviewErrorStatus } from './reply-read'

async function authorizeReplyLibrary(
  actor: AuthContext,
  propertyId: string,
): Promise<void> {
  await requireExecutionAllowed({
    actor,
    action: 'reply.manage',
    capability: 'property.publish_reply',
    propertyId,
  })
}

async function runReplyLibraryCommand<T>(command: () => Promise<T>): Promise<T> {
  try {
    return await command()
  } catch (error) {
    if (isReviewError(error)) {
      throwContextError('ReviewError', error, reviewErrorStatus(error.code))
    }
    throw catchUntagged(error)
  }
}

export const getPropertyReplyLibraryFn = createServerFn({ method: 'GET' })
  .validator(propertyReplyLibraryInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const actor = await resolveTenantContext(await headersFromContext())
        await authorizeReplyLibrary(actor, data.propertyId)
        return runReplyLibraryCommand(() =>
          getContainer().reviewPublicApi.reply.getPropertyLibrary(data, actor),
        )
      },
      'GET',
      'review.getPropertyReplyLibrary',
    ),
  )

export const savePropertyReplyProfileFn = createServerFn({ method: 'POST' })
  .validator(savePropertyReplyProfileInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const actor = await resolveTenantContext(await headersFromContext())
        await authorizeReplyLibrary(actor, data.propertyId)
        return runReplyLibraryCommand(() =>
          getContainer().reviewPublicApi.reply.savePropertyProfile(data, actor),
        )
      },
      'POST',
      'review.savePropertyReplyProfile',
    ),
  )

export const savePropertyReplyTemplateFn = createServerFn({ method: 'POST' })
  .validator(savePropertyReplyTemplateInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const actor = await resolveTenantContext(await headersFromContext())
        await authorizeReplyLibrary(actor, data.propertyId)
        return runReplyLibraryCommand(() =>
          getContainer().reviewPublicApi.reply.savePropertyTemplate(data, actor),
        )
      },
      'POST',
      'review.savePropertyReplyTemplate',
    ),
  )

export const setPropertyReplyTemplateEnabledFn = createServerFn({ method: 'POST' })
  .validator(setPropertyReplyTemplateEnabledInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const actor = await resolveTenantContext(await headersFromContext())
        await authorizeReplyLibrary(actor, data.propertyId)
        return runReplyLibraryCommand(() =>
          getContainer().reviewPublicApi.reply.setPropertyTemplateEnabled(data, actor),
        )
      },
      'POST',
      'review.setPropertyReplyTemplateEnabled',
    ),
  )
