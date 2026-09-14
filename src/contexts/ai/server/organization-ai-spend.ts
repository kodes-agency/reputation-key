import { createServerFn } from '@tanstack/react-start'
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { catchUntagged } from '#/shared/auth/server-errors'
import { tracedHandler } from '#/shared/observability/traced-server-fn'

/** The organization's AI spend this month against its cap; amounts only. */
export const getOrganizationAiSpendFn = createServerFn({ method: 'GET' }).handler(
  tracedHandler(
    async () => {
      const headers = await headersFromContext()
      const ctx = await resolveTenantContext(headers)
      await requireExecutionAllowed({ actor: ctx, action: 'ai.manage' })
      try {
        return await getContainer().aiPublicApi.readOrganizationAiSpend({
          organizationId: ctx.organizationId,
        })
      } catch (error) {
        throw catchUntagged(error)
      }
    },
    'GET',
    'ai.getOrganizationAiSpend',
  ),
)
