import { readAiReplyVoiceSnapshot } from './ai-reply-voice-snapshot'
import type { OrganizationId, PropertyId, ReviewId } from '#/shared/domain/ids'
import { replyBand } from '#/shared/reply-library/reply-voice'
import {
  digestResolvedReplyVoice,
  isReplyRenderError,
} from '#/shared/reply-library/render-reply'
import { buildAiReplyV2Frame } from './ai-reply-v2-frame'
import type { ReplyLibraryRepository } from './ports/reply-library.repository'
import type { ReviewRepository } from './ports/review.repository'

export type ResolveAiReplyV2FrameInput = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  reviewId: ReviewId
  languageGroup: string
  generationSeed: string
  nowEpochMillis: number
}>

export async function resolveAiReplyV2Frame(
  deps: Readonly<{ repository: ReplyLibraryRepository; reviews: ReviewRepository }>,
  input: ResolveAiReplyV2FrameInput,
) {
  if (!deps.repository.reserveAiFrame) return null
  const resolved = await readAiReplyVoiceSnapshot(deps, input)
  if (resolved === null) return null
  const { snapshot, review, voice, languageGroup } = resolved
  const band = replyBand(review.rating, Boolean(review.text?.trim()))
  const locale = voice.localized[languageGroup]
  const reservation = await deps.repository.reserveAiFrame({
    ...input,
    ratingBand: band,
    voiceDigest: digestResolvedReplyVoice(voice, languageGroup),
    optionCounts: {
      closing: locale.closings[band].value.length,
      signOff:
        locale.signOffWords[review.rating >= 4 ? 'positive' : 'negative'].value.length,
      contactSentence: locale.contactSentences.value.length,
      emoji: voice.emojiSet.value.length,
    },
  })
  if (!reservation) return null
  try {
    return buildAiReplyV2Frame(
      {
        voice,
        languageGroup,
        rating: review.rating,
        hasText: Boolean(review.text?.trim()),
        reviewerDisplayName: review.reviewerName,
        propertyDisplayName: snapshot.propertyName,
      },
      reservation,
    )
  } catch (error) {
    if (isReplyRenderError(error)) return null
    throw error
  }
}
