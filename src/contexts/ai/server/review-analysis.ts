import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod/v4'
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { catchUntagged, throwContextError } from '#/shared/auth/server-errors'
import { propertyId, reviewId } from '#/shared/domain/ids'
import { tracedHandler } from '#/shared/observability/traced-server-fn'

const requestReviewAnalysisNowDto = z.strictObject({ reviewId: z.uuid() })

/**
 * The manager is looking at a review whose analysis still waits in the
 * backlog: hand that one review to the worker's interactive lane. Reading the
 * review in the Inbox is the authority; nothing about the review leaves here.
 */
export const requestReviewAnalysisNowFn = createServerFn({ method: 'POST' })
  .validator(requestReviewAnalysisNowDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        const container = getContainer()
        try {
          const id = reviewId(data.reviewId)
          const current =
            await container.reviewPublicApi.aiReviewSource.readCurrentSource({
              organizationId: ctx.organizationId,
              reviewId: id,
            })
          if (current.status === 'not_found') {
            throwContextError(
              'AiError',
              { code: 'not_found', message: 'Review not found' },
              404,
            )
          }
          await requireExecutionAllowed({
            actor: ctx,
            action: 'inbox.read',
            propertyId: current.source.propertyId,
          })
          return await container.aiPublicApi.requestReviewAnalysisNow({
            organizationId: ctx.organizationId,
            propertyId: current.source.propertyId,
            reviewId: id,
          })
        } catch (error) {
          throw catchUntagged(error)
        }
      },
      'POST',
      'ai.requestReviewAnalysisNow',
    ),
  )

const getReviewAnalysisProgressDto = z.strictObject({ propertyId: z.uuid() })

/** How far Review Analysis has got for a property; content-free counts. */
export const getReviewAnalysisProgressFn = createServerFn({ method: 'GET' })
  .validator(getReviewAnalysisProgressDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        const id = propertyId(data.propertyId)
        await requireExecutionAllowed({
          actor: ctx,
          action: 'dashboard.read',
          propertyId: id,
        })
        try {
          return await getContainer().aiPublicApi.readReviewAnalysisProgress({
            organizationId: ctx.organizationId,
            propertyId: id,
          })
        } catch (error) {
          throw catchUntagged(error)
        }
      },
      'GET',
      'ai.getReviewAnalysisProgress',
    ),
  )
