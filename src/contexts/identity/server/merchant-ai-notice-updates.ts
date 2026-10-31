import { createServerFn } from '@tanstack/react-start'
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { catchUntagged, throwContextError } from '#/shared/auth/server-errors'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { MerchantAiAuthorizationError } from '../application/use-cases/merchant-ai-authorization'
import { merchantAiNoticeUpdateSeenInputSchema } from '../application/dto/merchant-ai-notice-update.dto'

async function updateContext() {
  const actor = await resolveTenantContext(await headersFromContext())
  await requireExecutionAllowed({ actor, action: 'ai.manage' })
  if (actor.role !== 'AccountAdmin') {
    throwContextError(
      'MerchantAiAuthorizationError',
      { code: 'capability_denied', message: 'Only an account admin can view AI updates' },
      403,
    )
  }
  return {
    organizationId: String(actor.organizationId),
    actorUserId: String(actor.userId),
  }
}

function updateError(error: unknown): never {
  if (error instanceof MerchantAiAuthorizationError) {
    throwContextError('MerchantAiAuthorizationError', error, 403)
  }
  throw catchUntagged(error)
}

export const getMerchantAiNoticeUpdateFn = createServerFn({ method: 'GET' }).handler(
  tracedHandler(
    async () => {
      const input = await updateContext()
      try {
        return await getContainer().identityPublicApi.requests.merchantAiNoticeUpdates.get(
          input,
        )
      } catch (error) {
        updateError(error)
      }
    },
    'GET',
    'identity.getMerchantAiNoticeUpdate',
  ),
)

export const markMerchantAiNoticeUpdateSeenFn = createServerFn({ method: 'POST' })
  .validator(merchantAiNoticeUpdateSeenInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const input = await updateContext()
        try {
          await getContainer().identityPublicApi.requests.merchantAiNoticeUpdates.markSeen(
            { ...input, ...data },
          )
        } catch (error) {
          updateError(error)
        }
      },
      'POST',
      'identity.markMerchantAiNoticeUpdateSeen',
    ),
  )
