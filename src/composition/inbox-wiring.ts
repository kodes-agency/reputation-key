import { randomUUID } from 'node:crypto'
import { buildInboxContext } from '#/contexts/reputation/build-inbox'
import { createInboxCommandAuthority } from '#/contexts/reputation/inbox/inbox-command-authority.adapter.server'
import { feedbackId } from '#/shared/domain/ids'
import { getLogger } from '#/shared/observability/logger'
import { createInboxReviewAnalysisReader } from './get-inbox-review-analysis.server'
import type { buildIdentityContext } from '#/contexts/identity/build'
import type { buildPropertyContext } from '#/contexts/property/build'
import type { buildGuestContext } from '#/contexts/guest/build'
import type { ReviewContextApi } from '#/contexts/reputation/build-review'
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
      // Feedback is the guest_responses aggregate the live guest form writes;
      // `guest.feedback.submitted` carries its row id. Read through Guest's
      // named snippet port; the root only brands the ids.
      feedback: {
        findResponseSnippetsByIds: async (ids, orgId) =>
          (await guest.snippets.findResponseSnippetsByIds(ids, orgId)).map((row) => ({
            ...row,
            id: feedbackId(row.id),
          })),
        findEligibleResponseIds: async (orgId, filter) =>
          (await guest.snippets.findEligibleResponseIds(orgId, filter)).map(feedbackId),
      },
      property: property.publicApi,
      // `review.lookups.*` are frozen objects of named reads, so passing them
      // on carries no repository write across; Inbox's lookup sources narrow
      // the type to the reads it uses.
      reply: {
        ...review.lookups.reply,
        getCurrentGoogleReplyByReviewId: review.publicApi.getCurrentGoogleReplyByReviewId,
      },
      review: review.lookups.review,
      replyObservationAuthority: review.publicApi.replyObservationAuthority,
      responseTargetAuthority: review.publicApi.responseTargetAuthority,
      sourceTransitionAuthority: review.publicApi.sourceTransitionAuthority,
      googleReviewCheck: review.publicApi.checkReviewOnGoogle,
    },
    logger: getLogger(),
  })
  return inbox
}
