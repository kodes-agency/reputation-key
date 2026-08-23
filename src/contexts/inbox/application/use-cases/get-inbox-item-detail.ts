// Inbox context — get inbox item detail use case
// Returns full detail view (item + source data) for a single inbox item.
// Enforces role-scoped property access.

import type { InboxRepository } from '../ports/inbox.repository'
import type { PropertyLookupPort } from '../ports/property-lookup.port'
import type { ReplyLookupPort, ReplyView } from '../ports/reply-lookup.port'
import type {
  AiReviewInsightsPort,
  InboxReviewAnalysis,
} from '../ports/ai-review-insights.port'
import type { InboxItemId, ReviewId } from '#/shared/domain/ids'
import type { InboxItemDetail } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { canForContext } from '#/shared/domain/permissions'
import { inboxError } from '../../domain/errors'
import { assertPropertyAccessible } from '../inbox-access'
import {
  mapReplyLanguageMetadata,
  parseCanonicalReplyLanguageTag,
} from '#/shared/reply-language-catalogue'

export type GetInboxItemDetailInput = Readonly<{
  inboxItemId: InboxItemId
}>

export type GetInboxItemDetailDeps = Readonly<{
  repo: InboxRepository
  staffPublicApi: StaffPublicApi
  replyLookup: ReplyLookupPort
  propertyLookup?: PropertyLookupPort
  aiInsights?: AiReviewInsightsPort
}>

/** Detail result with the review's reply attached (review items only).
 *  The reply is filled in the use case — not the repo — because only the use
 *  case has the AuthContext to permission-gate it (reply.manage). Intentional
 *  asymmetry with the review/feedback/property lookups, which enrich inside
 *  the repo (no auth needed for snippets). */
export type InboxItemDetailResult = Readonly<
  InboxItemDetail & {
    reply: ReplyView | null
    analysis: InboxReviewAnalysis | null
    propertyDefaultReplyLanguage?: string | null
    reviewReplyLanguage?: string | null
  }
>

export const getInboxItemDetail =
  (deps: GetInboxItemDetailDeps) =>
  async (
    input: GetInboxItemDetailInput,
    ctx: AuthContext,
  ): Promise<InboxItemDetailResult> => {
    if (!canForContext(ctx, 'inbox.read')) {
      throw inboxError('forbidden', 'No inbox read permission')
    }
    const detail = await deps.repo.findDetailById(input.inboxItemId, ctx.organizationId)
    if (!detail) {
      throw inboxError('not_found', 'Inbox item not found', {
        inboxItemId: input.inboxItemId,
      })
    }

    await assertPropertyAccessible(
      deps.staffPublicApi,
      ctx,
      'inbox.read',
      detail.item.propertyId,
    )

    // Attach the review's effective reply (internal, else the google_sync
    // mirror — without the mirror fallback, replies published via the GBP UI
    // are invisible and the panel renders a compose box over them). Primary
    // authorization is inbox.read (above); reply.manage is a field-level
    // scope so Staff (who lack it) never receive reply data. Mild tension
    // with ADR 0009 §6 ("each use case maps to exactly one permission") —
    // justified by mandatory leak prevention.
    let reply: ReplyView | null = null
    let analysis: InboxReviewAnalysis | null = null
    if (detail.item.sourceType === 'review' && deps.aiInsights) {
      analysis = await deps.aiInsights.readCurrentReviewAnalysis({
        organizationId: ctx.organizationId,
        propertyId: detail.item.propertyId,
        reviewId: detail.item.sourceId as ReviewId,
        actorUserId: ctx.userId,
      })
    }
    if (detail.item.sourceType === 'review' && canForContext(ctx, 'reply.manage')) {
      reply = await deps.replyLookup.getEffectiveReplyByReviewId(
        detail.item.sourceId as ReviewId,
        ctx.organizationId,
      )
    }

    const configuredPropertyLanguage = deps.propertyLookup?.getPropertyReplyLanguageById
      ? await deps.propertyLookup.getPropertyReplyLanguageById(
          detail.item.propertyId,
          ctx.organizationId,
        )
      : null
    const propertyDefaultReplyLanguage =
      configuredPropertyLanguage !== null &&
      parseCanonicalReplyLanguageTag(configuredPropertyLanguage) !== null
        ? configuredPropertyLanguage
        : null
    const mappedReviewLanguage = mapReplyLanguageMetadata(detail.item.reviewLanguageCode)
    const reviewReplyLanguage =
      mappedReviewLanguage.status === 'supported' &&
      mappedReviewLanguage.language !== null
        ? mappedReviewLanguage.language.tag
        : null

    return {
      ...detail,
      reply,
      analysis,
      propertyDefaultReplyLanguage,
      reviewReplyLanguage,
    }
  }

export type GetInboxItemDetailUseCase = ReturnType<typeof getInboxItemDetail>
