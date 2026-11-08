import { replyCommentProblem } from '#/shared/google-provider-control/reply-comment'
import { checkReplyText } from '#/shared/reply-library/reply-checks'
import { BUILTIN_REPLY_VOICE, resolveVoice } from '#/shared/reply-library/reply-voice'
import {
  mapReplyLanguageMetadata,
  parseCanonicalReplyLanguageTag,
} from '#/shared/reply-language-catalogue'
import type { Reply, Review } from '../domain/types'
import { reviewError } from '../domain/errors'
import { assertReplySlotsFilled, replyTextProblemMessage } from '../domain/rules'
import type { ReplyLibraryRepository } from './ports/reply-library.repository'

/** The same byte and character rules the Google reply route enforces. */
export function assertReplyTextSendable(text: string): void {
  const problem = replyCommentProblem(text)
  if (problem !== null)
    throw reviewError('invalid_reply', replyTextProblemMessage(problem))
}

/** Every new publication uses the current effective voice, including retries. */
export async function assertReplyContentPublishable(
  library: Pick<ReplyLibraryRepository, 'loadSnapshot'> | undefined,
  reply: Reply,
  review: Review,
): Promise<void> {
  assertReplyTextSendable(reply.text)
  assertReplySlotsFilled(reply.text)

  const mappedReviewLanguage = mapReplyLanguageMetadata(review.languageCode)
  const languageGroup =
    (reply.replyLanguageTag
      ? parseCanonicalReplyLanguageTag(reply.replyLanguageTag)?.templateGroup
      : undefined) ??
    (mappedReviewLanguage.status === 'supported'
      ? mappedReviewLanguage.language?.templateGroup
      : undefined) ??
    'en-Latn'
  const snapshot = await library?.loadSnapshot(review.organizationId, review.propertyId)
  const voice = snapshot
    ? resolveVoice(BUILTIN_REPLY_VOICE, snapshot.accountVoice, snapshot.propertyVoice)
    : null
  const findings = checkReplyText({
    text: reply.text,
    kind: 'final_reply',
    rating: review.rating,
    reviewKind: review.text == null || review.text.trim() === '' ? 'rating_only' : 'text',
    languageGroup,
    privacyMode: voice?.privacyMode.value ?? false,
    emojiAllowed: voice?.emojiMode.value === 'positive',
  }).blocks
  if (findings.length > 0) {
    throw reviewError('invalid_reply', 'Reply failed required safety checks', {
      findingCodes: findings.map(({ code }) => code),
    })
  }
}
