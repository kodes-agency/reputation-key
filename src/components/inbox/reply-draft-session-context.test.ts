import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  backgroundDraftTarget,
  BACKGROUND_DRAFT_DWELL_MILLIS,
  ReplyDraftSessionProvider,
} from './reply-draft-session-context'
import type { InboxItemDetailResult } from '#/contexts/inbox/application/public-api'
import { makeInboxItem } from '../../../.storybook/in-memory/inbox-container'
import { useStreamedReplyDraft } from './use-streamed-reply-draft'
import { ReviewProse } from './review-prose'
const item = makeInboxItem({
  id: '750e8400-e29b-41d4-a716-446655440020',
  sourceType: 'review',
})
const detail: InboxItemDetailResult = {
  item,
  reviewText: 'The room was very clean.',
  reviewTranslatedText: null,
  reviewerProfilePhotoUrl: null,
  googleReviewUrl: null,
  googlePropertyReviewsUrl: null,
  reviewContentStatus: 'available',
  reviewRating: 5,
  feedbackComment: null,
  feedbackRatingValue: null,
  reply: null,
  analysis: null,
  feedbackHandling: null,
  responseTarget: null,
  propertyDefaultReplyLanguage: 'en-Latn',
  replyDraftingAvailable: true,
}
function Probe() {
  const { session, state, generate } = useStreamedReplyDraft(undefined)
  return session && generate && !state.visible
    ? createElement(ReviewProse, { text: 'Original words.', evidence: null })
    : null
}
describe('background drafting admission in the detail', () => {
  it('waits two seconds and only admits text, no reply, supported language and current user/property consent', () => {
    expect(BACKGROUND_DRAFT_DWELL_MILLIS).toBe(2000)
    expect(backgroundDraftTarget(detail)).toEqual({ kind: 'property_default' })
    for (const patch of [
      { reviewText: '' },
      { replyDraftingAvailable: false },
      { propertyDefaultReplyLanguage: 'tr-Latn' },
    ]) {
      expect(backgroundDraftTarget({ ...detail, ...patch })).toBeNull()
    }
    expect(backgroundDraftTarget(null)).toBeNull()
  })
  it('owns the stream above the editor without showing hidden state or altering original prose', () => {
    const markup = renderToStaticMarkup(
      createElement(ReplyDraftSessionProvider, {
        item,
        detail,
        children: createElement(Probe),
      }),
    )
    expect(markup).toBe('Original words.')
  })
})
