import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { catchUntagged, throwContextError } from '#/shared/auth/server-errors'
import { getContainer } from '#/composition'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import {
  getPrivateFeedbackTargetAnalyticsDto,
  getResponseTargetPolicySettingsDto,
  setResponseTargetPolicyDto,
} from '../application/dto/inbox.dto'
import {
  createServerFn,
  inboxErrorStatus,
  isInboxError,
  propertyId,
} from './inbox-shared'

function rethrowInboxError(error: unknown): never {
  if (isInboxError(error)) {
    throwContextError('InboxError', error, inboxErrorStatus(error.code))
  }
  throw catchUntagged(error)
}

export const getResponseTargetPolicySettingsFn = createServerFn({ method: 'GET' })
  .validator(getResponseTargetPolicySettingsDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({ actor: ctx, action: 'organization.update' })
        try {
          return await getContainer().inboxPublicApi.getResponseTargetPolicySettings(
            data.propertyId ? { propertyId: propertyId(data.propertyId) } : {},
            ctx,
          )
        } catch (error) {
          return rethrowInboxError(error)
        }
      },
      'GET',
      'inbox.getResponseTargetPolicySettings',
    ),
  )

export const getPrivateFeedbackTargetAnalyticsFn = createServerFn({ method: 'GET' })
  .validator(getPrivateFeedbackTargetAnalyticsDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({ actor: ctx, action: 'inbox.read' })
        try {
          return await getContainer().inboxPublicApi.getPrivateFeedbackTargetAnalytics(
            data.propertyId ? { propertyId: propertyId(data.propertyId) } : {},
            ctx,
          )
        } catch (error) {
          return rethrowInboxError(error)
        }
      },
      'GET',
      'inbox.getPrivateFeedbackTargetAnalytics',
    ),
  )

export const getGoogleReviewTargetAnalyticsFn = createServerFn({ method: 'GET' })
  .validator(getPrivateFeedbackTargetAnalyticsDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({ actor: ctx, action: 'inbox.read' })
        try {
          return await getContainer().inboxPublicApi.getGoogleReviewTargetAnalytics(
            data.propertyId ? { propertyId: propertyId(data.propertyId) } : {},
            ctx,
          )
        } catch (error) {
          return rethrowInboxError(error)
        }
      },
      'GET',
      'inbox.getGoogleReviewTargetAnalytics',
    ),
  )

export const setResponseTargetPolicyFn = createServerFn({ method: 'POST' })
  .validator(setResponseTargetPolicyDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({ actor: ctx, action: 'organization.update' })
        try {
          const input =
            data.scope === 'property'
              ? { ...data, propertyId: propertyId(data.propertyId) }
              : data
          return await getContainer().inboxPublicApi.setResponseTargetPolicy(input, ctx)
        } catch (error) {
          return rethrowInboxError(error)
        }
      },
      'POST',
      'inbox.setResponseTargetPolicy',
    ),
  )
