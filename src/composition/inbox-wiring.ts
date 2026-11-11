import { randomUUID } from 'node:crypto'
import { buildInboxContext } from '#/contexts/inbox/build'
import { createInboxCommandAuthority } from '#/contexts/inbox/infrastructure/adapters/inbox-command-authority.adapter'
import { feedbackId } from '#/shared/domain/ids'
import { getLogger } from '#/shared/observability/logger'
import { createInboxReviewAnalysisReader } from './get-inbox-review-analysis.server'
import type { buildIdentityContext } from '#/contexts/identity/build'
import type { buildPropertyContext } from '#/contexts/property/build'
import type { buildGuestContext } from '#/contexts/guest/build'
import type { ReviewContextApi } from '#/contexts/review/build'
import type { buildAiContext } from '#/contexts/ai/build'
import type { ContextWiringInput } from './runtime'

export function wireInbox(
  { db, clock, infra }: ContextWiringInput,
  identity: ReturnType<typeof buildIdentityContext>,
  property: ReturnType<typeof buildPropertyContext>,
  guest: ReturnType<typeof buildGuestContext>,
  review: ReviewContextApi,
  ai: ReturnType<typeof buildAiContext>,
) {
  const inbox = buildInboxContext({
    db,
    clock,
    idGen: randomUUID,
    staffPublicApi: identity.publicApi.people,
    rateLimiter: infra.rateLimiter,
    authorizeCommand: createInboxCommandAuthority({
      decideManagerPropertyAuthorities:
        identity.authority.decideManagerPropertyAuthorities,
    }),
    // review.publicApi is the governed read interface: it satisfies the Inbox
    // ReviewLookupPort directly, so no per-context eligibility adapter remains
    // (single rule, one owner).
    reviewLookup: review.publicApi,
    aiInsights: {
      readCurrentReviewAnalysis: createInboxReviewAnalysisReader({
        readCurrentSource: review.publicApi.aiReviewSource.readCurrentSource,
        readReviewAnalysis: ai.publicApi.readReviewAnalysis,
      }),
      findCurrentReviewIdsByAttention: ai.publicApi.findCurrentReviewIdsByAttention,
      findCurrentReviewIdsByIssue: ai.publicApi.findCurrentReviewIdsByIssue,
    },
    // Foreign read sources the inbox build adapts into its lookup ports.
    sources: {
      // Feedback spans two storage generations: the guest_responses aggregate
      // that the live guest form writes, and the legacy feedback/ratings pair.
      // `guest.feedback.submitted` carries the aggregate row id, so the
      // aggregate read is what makes a new feedback inbox item render at all —
      // the legacy lookup cannot resolve that id.
      // ARC-03-T11: read through Guest's named snippet port. The root's only
      // remaining job is the FeedbackId branding both generations share.
      feedback: {
        findResponseSnippetsByIds: async (ids, orgId) =>
          (await guest.snippets.findResponseSnippetsByIds(ids, orgId)).map((row) => ({
            ...row,
            id: feedbackId(row.id),
          })),
        findEligibleResponseIds: async (orgId, filter) =>
          (await guest.snippets.findEligibleResponseIds(orgId, filter)).map(feedbackId),
        findLegacyFeedbackSnippetsByIds: guest.snippets.findLegacyFeedbackSnippetsByIds,
        findEligibleLegacyFeedbackIds: guest.snippets.findEligibleLegacyFeedbackIds,
      },
      property: property.publicApi,
      // Named reads, not a spread of the repository.
      //
      // `review.lookups.reply` is typed `ReplyRepository`, and the repository
      // is built as an object literal, so every method is own-enumerable and
      // `{ ...review.lookups.reply }` handed Inbox `upsert`, the draft writes
      // and `deleteByReviewIdAndSource` as well. The declared
      // `ReplyLookupSource` narrows the TYPE, so typed Inbox code cannot call
      // them — but the object still carried them at runtime, reachable through
      // any cast, a structural widening of the port, or anything that iterates
      // or serialises the source. A spread does not trigger excess-property
      // checking, and the cross-context eslint rule inspects import paths, not
      // injected objects, so neither noticed. Review's own build comment says
      // "the repositories themselves stay context-private"; this is what makes
      // that true at runtime, not only in the types.
      reply: {
        findByReviewId: review.lookups.reply.findByReviewId,
        findMilestonesByReviewIds: review.lookups.reply.findMilestonesByReviewIds,
        findCurrentGoogleReplyHeadsByReviewIds:
          review.lookups.reply.findCurrentGoogleReplyHeadsByReviewIds,
        findStatesByReviewIds: review.lookups.reply.findStatesByReviewIds,
        findReviewIdsByReplyStage: review.lookups.reply.findReviewIdsByReplyStage,
        getCurrentGoogleReplyByReviewId: review.publicApi.getCurrentGoogleReplyByReviewId,
      },
      // Named for the same reason as `reply` above: `review.lookups.review` is
      // the whole `ReviewRepository`, and `ReviewSourceLookupSource` narrows
      // the type without narrowing the object.
      review: {
        findById: review.lookups.review.findById,
        findByIds: review.lookups.review.findByIds,
        findByOrganizationId: review.lookups.review.findByOrganizationId,
        findByPropertyId: review.lookups.review.findByPropertyId,
      },
      replyObservationAuthority: review.publicApi.replyObservationAuthority,
      responseTargetAuthority: review.publicApi.responseTargetAuthority,
      sourceTransitionAuthority: review.publicApi.sourceTransitionAuthority,
      googleReviewCheck: review.publicApi.checkReviewOnGoogle,
    },
    logger: getLogger(),
  })
  return inbox
}
