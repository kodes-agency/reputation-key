import { getContainer } from '#/composition'
import { getExecutionPolicy } from '#/shared/auth/execution-policy'
import type { AuthContext } from '#/shared/domain/auth-context'
import {
  reviewId,
  type InboxItemId,
  type PropertyId,
  type ReviewId,
} from '#/shared/domain/ids'
import type { DraftReviewReaders } from '../application/read-models/guest-voice-v2-resolve'

/**
 * The Inbox Items that open reviews for this reader, and what the reviews say now. Both
 * are Inbox and Review answers under the reader's own access: a review the reader may
 * not open is not quoted. Opening one is an Inbox read, which `dashboard.read` does not
 * grant, so a reader the policy refuses `inbox.read` gets the page without any words.
 */
export function guestVoiceEvidenceReaders(
  ctx: AuthContext,
  pid: PropertyId,
): DraftReviewReaders {
  const { clock, inboxPublicApi, reviewPublicApi } = getContainer()
  return {
    inboxItemIds: async (ids) => {
      const decision = await getExecutionPolicy().decide({
        principal: { kind: 'user', ctx },
        action: 'inbox.read',
        organizationId: ctx.organizationId,
        propertyId: pid,
        executionKind: 'interactive',
        now: clock(),
      })
      if (!decision.allowed) return new Map<string, string>()
      const items: ReadonlyMap<ReviewId, InboxItemId> =
        await inboxPublicApi.getReviewInboxItemIds(
          { propertyId: pid, reviewIds: ids.map(reviewId) },
          ctx,
        )
      return new Map(
        [...items].map(([review, item]) => [review as string, item as string]),
      )
    },
    reviewTexts: async (ids) => {
      const snippets = await reviewPublicApi.getReviewSnippetsByIds(
        ids.map(reviewId),
        ctx.organizationId,
      )
      return new Map(
        ids.map((id) => {
          const snippet = snippets.get(id)
          return [
            id,
            snippet === undefined
              ? null
              : { text: snippet.text, sourceRevision: snippet.sourceRevision },
          ] as const
        }),
      )
    },
  }
}
