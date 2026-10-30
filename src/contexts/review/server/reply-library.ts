import { createServerFn } from '@tanstack/react-start'
import { getContainer } from '#/composition'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { catchUntagged, throwContextError } from '#/shared/auth/server-errors'
import type { AuthContext } from '#/shared/domain/auth-context'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import {
  getReplyLibraryInputSchema,
  resetReplyTemplateInputSchema,
  saveReplyTemplateInputSchema,
  saveReplyVoiceInputSchema,
  setReplyTemplateHiddenInputSchema,
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

async function authorizeLayeredReplyLibrary(
  actor: AuthContext,
  propertyId: string,
): Promise<void> {
  await requireExecutionAllowed({
    actor,
    action: 'reply_library.manage',
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

export const getReplyLibraryFn = createServerFn({ method: 'GET' })
  .validator(getReplyLibraryInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const actor = await resolveTenantContext(await headersFromContext())
        await authorizeReplyLibrary(actor, data.propertyId)
        return runReplyLibraryCommand(() =>
          getContainer().reviewPublicApi.reply.getLibrary(data, actor),
        )
      },
      'GET',
      'review.getReplyLibrary',
    ),
  )

export const saveReplyVoiceFn = createServerFn({ method: 'POST' })
  .validator(saveReplyVoiceInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const actor = await resolveTenantContext(await headersFromContext())
        await authorizeLayeredReplyLibrary(actor, data.propertyId)
        return runReplyLibraryCommand(() =>
          getContainer().reviewPublicApi.reply.saveVoice(data, actor),
        )
      },
      'POST',
      'review.saveReplyVoice',
    ),
  )

// fallow-ignore-next-line unused-export -- resolved by a route-level dynamic import
export const saveReplyTemplateFn = createServerFn({ method: 'POST' })
  .validator(saveReplyTemplateInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const actor = await resolveTenantContext(await headersFromContext())
        await authorizeLayeredReplyLibrary(actor, data.propertyId)
        return runReplyLibraryCommand(() =>
          getContainer().reviewPublicApi.reply.saveTemplate(data, actor),
        )
      },
      'POST',
      'review.saveReplyTemplate',
    ),
  )

// fallow-ignore-next-line unused-export -- resolved by a route-level dynamic import
export const setReplyTemplateHiddenFn = createServerFn({ method: 'POST' })
  .validator(setReplyTemplateHiddenInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const actor = await resolveTenantContext(await headersFromContext())
        await authorizeLayeredReplyLibrary(actor, data.propertyId)
        return runReplyLibraryCommand(() =>
          getContainer().reviewPublicApi.reply.setTemplateHidden(data, actor),
        )
      },
      'POST',
      'review.setReplyTemplateHidden',
    ),
  )

// fallow-ignore-next-line unused-export -- resolved by a route-level dynamic import
export const resetReplyTemplateFn = createServerFn({ method: 'POST' })
  .validator(resetReplyTemplateInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const actor = await resolveTenantContext(await headersFromContext())
        await authorizeLayeredReplyLibrary(actor, data.propertyId)
        return runReplyLibraryCommand(() =>
          getContainer().reviewPublicApi.reply.resetTemplate(data, actor),
        )
      },
      'POST',
      'review.resetReplyTemplate',
    ),
  )
