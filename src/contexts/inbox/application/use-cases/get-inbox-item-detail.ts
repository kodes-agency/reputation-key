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
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type {
  FeedbackHandlingState,
  FeedbackHandlingStore,
} from '../ports/feedback-handling.store'
import type {
  ResponseTargetStore,
  ResponseTargetView,
} from '../ports/response-target.store'
import { canForContext } from '#/shared/domain/permissions'
import { inboxError } from '../../domain/errors'
import {
  assertInboxSourcePropertyAccessible,
  canHandleInboxSource,
  canReadInboxSource,
  isInboxSourcePropertyWithinScopes,
  loadInboxItemOrThrow,
  resolveInboxSourceScopes,
} from '../inbox-access'
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
  feedbackHandlingStore?: FeedbackHandlingStore
  responseTargetStore?: ResponseTargetStore
  clock?: () => Date
}>

/** Detail result with the review's reply attached (review items only).
 *  The reply is filled in the use case — not the repo — because only the use
 *  case has the AuthContext to permission-gate it (reply.manage). Intentional
 *  asymmetry with the review/feedback/property lookups, which enrich inside
 *  the repo (no auth needed for snippets).
 *
 *  `reviewRating` is one of those repo-enriched fields and is inherited from
 *  `InboxItemDetail` rather than re-declared here, so the eligibility rule it
 *  obeys is documented in exactly one place (`domain/types.ts`). What this use
 *  case adds is a wire guarantee: the returned payload always carries the key
 *  with a `number | null` value, never `undefined`, whatever the repository
 *  implementation handed it. The pane reads `detail.reviewRating` as its only
 *  rating source — never `item.rating`, which the detail read nulls for every
 *  row (`inbox.mapper.ts:37`). */
export type InboxItemDetailResult = Readonly<
  InboxItemDetail & {
    reply: ReplyView | null
    analysis: InboxReviewAnalysis | null
    propertyDefaultReplyLanguage?: string | null
    reviewReplyLanguage?: string | null
    /** Manager-only private-feedback outcome history, including internal notes. */
    feedbackHandling: FeedbackHandlingState | null
    /** Current Handling Cycle target; elapsed/overdue state uses one server instant. */
    responseTarget: ResponseTargetView | null
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
    // Load projection-owned metadata before any owning-context content lookup.
    // This lets source permission and Property scope be checked without reading
    // private feedback text first.
    const item = await loadInboxItemOrThrow(
      deps.repo,
      input.inboxItemId,
      ctx.organizationId,
    )
    if (!canReadInboxSource(ctx, item.sourceType)) {
      throw inboxError('forbidden', 'No access to this inbox source')
    }

    await assertInboxSourcePropertyAccessible(
      deps.staffPublicApi,
      ctx,
      'read',
      item.sourceType,
      item.propertyId,
    )

    const detail = await deps.repo.findDetailById(input.inboxItemId, ctx.organizationId)
    if (!detail) {
      throw inboxError('not_found', 'Inbox item not found', {
        inboxItemId: input.inboxItemId,
      })
    }

    // Attach the review's effective reply; its precedence (including the
    // saved, unpublished draft that seeds the compose box) is defined on
    // ReplyLookupPort.getEffectiveReplyByReviewId.
    // Without provider truth, replies published via the GBP UI are invisible
    // and the panel renders a compose box over them. Primary
    // authorization is inbox.read (above); reply.manage is a field-level
    // scope so Staff (who lack it) never receive reply data. Mild tension
    // with ADR 0009 §6 ("each use case maps to exactly one permission") —
    // justified by mandatory leak prevention.
    // The five enrichments are INDEPENDENT of one another — each reads a
    // different store off the already-loaded `detail` — so they are issued
    // together. Awaited in sequence, the pane's hot path paid their latencies
    // one after another; concurrently it pays roughly the slowest one (the
    // feedback branch's two reads count once, in its own thunk). That branch is
    // the only one with an internal order (its scope check gates its read), and
    // that order is kept inside its own thunk.
    //
    // Request-level access was settled above (`inbox.read`,
    // `canReadInboxSource`, the read property-scope assertion). The checks
    // below are field-level scopes — `reply.manage` for the reply, and the
    // feedback handle permission plus handle property scope for
    // feedbackHandling — each evaluated before its own read inside its own
    // branch or thunk, so running the reads concurrently cannot widen what the
    // caller receives.
    const isReview = detail.item.sourceType === 'review'
    const readFeedbackHandling = async (): Promise<FeedbackHandlingState | null> => {
      if (
        detail.item.sourceType !== 'feedback' ||
        !deps.feedbackHandlingStore ||
        !canHandleInboxSource(ctx, 'feedback')
      ) {
        return null
      }
      const handlingScopes = await resolveInboxSourceScopes(
        deps.staffPublicApi,
        ctx,
        'handle',
      )
      if (
        !isInboxSourcePropertyWithinScopes(
          handlingScopes,
          'feedback',
          detail.item.propertyId,
        )
      ) {
        return null
      }
      return deps.feedbackHandlingStore.getState(detail.item.id, ctx.organizationId)
    }

    const [
      analysis,
      reply,
      feedbackHandling,
      responseTarget,
      configuredPropertyLanguage,
    ]: [
      InboxReviewAnalysis | null,
      ReplyView | null,
      FeedbackHandlingState | null,
      ResponseTargetView | null,
      string | null,
    ] = await Promise.all([
      isReview && deps.aiInsights
        ? deps.aiInsights.readCurrentReviewAnalysis({
            organizationId: ctx.organizationId,
            propertyId: detail.item.propertyId,
            reviewId: detail.item.sourceId as ReviewId,
            actorUserId: ctx.userId,
          })
        : null,
      isReview && canForContext(ctx, 'reply.manage')
        ? deps.replyLookup.getEffectiveReplyByReviewId(
            detail.item.sourceId as ReviewId,
            ctx.organizationId,
          )
        : null,
      readFeedbackHandling(),
      deps.responseTargetStore && deps.clock
        ? deps.responseTargetStore.getCycleTarget(
            detail.item.id,
            ctx.organizationId,
            deps.clock(),
          )
        : null,
      deps.propertyLookup?.getPropertyReplyLanguageById
        ? deps.propertyLookup.getPropertyReplyLanguageById(
            detail.item.propertyId,
            ctx.organizationId,
          )
        : null,
    ])
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
      // Normalise, do not source: the repo already applied the eligibility rule
      // (null for `expired` / `not_found`, null for feedback) when it read the
      // snippet. Re-reading the review here would mean a second authorized
      // fetch of the same source, and under ADR 0031 a successful fetch is what
      // advances the staleness clock — one detail open must not count twice.
      // All this line does is collapse a `reviewRating`-less detail (the
      // in-memory repo's peers, hand-built fixtures) to an explicit `null`.
      reviewRating: detail.reviewRating ?? null,
      reply,
      analysis,
      propertyDefaultReplyLanguage,
      reviewReplyLanguage,
      feedbackHandling,
      responseTarget,
    }
  }

export type GetInboxItemDetail = ReturnType<typeof getInboxItemDetail>
