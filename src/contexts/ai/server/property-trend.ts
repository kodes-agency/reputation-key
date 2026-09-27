import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod/v4'
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import {
  getExecutionPolicy,
  requireExecutionAllowed,
} from '#/shared/auth/execution-policy'
import { catchUntagged } from '#/shared/auth/server-errors'
import type { AuthContext } from '#/shared/domain/auth-context'
import {
  propertyId,
  type InboxItemId,
  type PropertyId,
  type ReviewId,
} from '#/shared/domain/ids'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import {
  trendSupportingReviewIds,
  withSupportingReviewItems,
} from '../application/trend-report-view'

const getPropertyAiTrendDto = z.object({ propertyId: z.uuid() })

/**
 * The Inbox Items that open a trend's supporting reviews for this viewer.
 * Opening one is an Inbox read, which `ai.trends.read` does not grant: a viewer
 * the policy refuses `inbox.read` gets no links rather than a failed trend.
 */
async function supportingReviewItems(
  ctx: AuthContext,
  pid: PropertyId,
  reviewIds: readonly ReviewId[],
): Promise<ReadonlyMap<ReviewId, InboxItemId>> {
  if (reviewIds.length === 0) return new Map()
  const { clock, inboxPublicApi } = getContainer()
  const inboxDecision = await getExecutionPolicy().decide({
    principal: { kind: 'user', ctx },
    action: 'inbox.read',
    organizationId: ctx.organizationId,
    propertyId: pid,
    executionKind: 'interactive',
    now: clock(),
  })
  if (!inboxDecision.allowed) return new Map()
  return inboxPublicApi.getReviewInboxItemIds({ propertyId: pid, reviewIds }, ctx)
}

export const getPropertyAiTrendFn = createServerFn({ method: 'GET' })
  .validator(getPropertyAiTrendDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        const id = propertyId(data.propertyId)
        await requireExecutionAllowed({
          actor: ctx,
          action: 'ai.trends.read',
          propertyId: id,
        })
        try {
          const read = await getContainer().aiPublicApi.readPropertyTrend({
            organizationId: ctx.organizationId,
            propertyId: id,
            actorUserId: ctx.userId,
          })
          const itemIds = await supportingReviewItems(
            ctx,
            id,
            trendSupportingReviewIds(read),
          )
          return withSupportingReviewItems(read, itemIds)
        } catch (error) {
          throw catchUntagged(error)
        }
      },
      'GET',
      'ai.getPropertyTrend',
    ),
  )
